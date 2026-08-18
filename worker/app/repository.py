import json
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.rows import dict_row


@dataclass(frozen=True)
class TaskAssets:
    task_id: str
    reference_key: str
    target_key: str
    reference_is_raw: bool
    target_is_raw: bool


class TaskRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def claim(self, task_id: str) -> TaskAssets | None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            task = connection.execute(
                """UPDATE color_tasks
                   SET status = 'measuring', worker_received_at = COALESCE(worker_received_at, now()),
                       error_code = NULL, updated_at = now()
                   WHERE id = %s AND status = 'queued' AND expires_at > now()
                   RETURNING id""",
                (task_id,),
            ).fetchone()
            if task is None:
                return None
            rows = connection.execute(
                "SELECT role, object_key, is_raw FROM task_assets WHERE task_id = %s",
                (task_id,),
            ).fetchall()
            assets = {row["role"]: row for row in rows}
            if "reference" not in assets or "target" not in assets:
                connection.execute(
                    """UPDATE color_tasks SET status = 'measurement_failed', error_code = 'measurement_asset_unavailable', updated_at = now()
                       WHERE id = %s AND status = 'measuring'""",
                    (task_id,),
                )
                return None
            return TaskAssets(
                task_id,
                assets["reference"]["object_key"],
                assets["target"]["object_key"],
                bool(assets["reference"]["is_raw"]),
                bool(assets["target"]["is_raw"]),
            )

    def preview_asset_is_current(self, task_id: str, role: str, object_key: str) -> bool:
        with psycopg.connect(self.database_url) as connection:
            row = connection.execute(
                """SELECT 1
                   FROM color_tasks t
                   JOIN task_assets a ON a.task_id = t.id AND a.role = %s
                   JOIN task_upload_slots s ON s.task_id = t.id AND s.role = a.role
                   WHERE t.id = %s AND t.status = 'collecting' AND t.expires_at > now()
                     AND a.object_key = %s AND a.is_raw = true AND s.status = 'confirmed'""",
                (role, task_id, object_key),
            ).fetchone()
            return row is not None

    def set_preview(self, task_id: str, role: str, object_key: str, preview_key: str) -> bool:
        with psycopg.connect(self.database_url) as connection:
            changed = connection.execute(
                """UPDATE task_assets a
                   SET preview_object_key = %s
                   FROM color_tasks t, task_upload_slots s
                   WHERE a.task_id = %s AND a.role = %s AND a.object_key = %s
                     AND t.id = a.task_id AND t.status = 'collecting' AND t.expires_at > now()
                     AND s.task_id = a.task_id AND s.role = a.role AND s.status = 'confirmed'
                   RETURNING a.id""",
                (preview_key, task_id, role, object_key),
            ).fetchone()
            return changed is not None

    def fail_preview(self, task_id: str, role: str, object_key: str, error_code: str) -> bool:
        with psycopg.connect(self.database_url) as connection:
            changed = connection.execute(
                """UPDATE task_upload_slots s
                   SET status = 'failed', error_code = %s, updated_at = now()
                   FROM color_tasks t, task_assets a
                   WHERE s.task_id = %s AND s.role = %s
                     AND t.id = s.task_id AND t.status = 'collecting' AND t.expires_at > now()
                     AND a.task_id = s.task_id AND a.role = s.role AND a.object_key = %s
                   RETURNING s.task_id""",
                (error_code, task_id, role, object_key),
            ).fetchone()
            return changed is not None

    def save_measurements(
        self,
        task_id: str,
        schema_version: int,
        reference: dict[str, Any],
        target: dict[str, Any],
        comparison: dict[str, Any],
    ) -> bool:
        with psycopg.connect(self.database_url) as connection:
            active = connection.execute(
                """UPDATE color_tasks
                   SET status = 'recognizing', error_code = NULL, updated_at = now()
                   WHERE id = %s AND status = 'measuring' AND expires_at > now()
                   RETURNING id""",
                (task_id,),
            ).fetchone()
            if active is None:
                return False
            connection.execute(
                """INSERT INTO image_measurements
                     (task_id, schema_version, reference_result, target_result, comparison_result, completed_at)
                   VALUES (%s, %s, %s::jsonb, %s::jsonb, %s::jsonb, now())
                   ON CONFLICT (task_id) DO UPDATE SET
                     schema_version = EXCLUDED.schema_version,
                     reference_result = EXCLUDED.reference_result,
                     target_result = EXCLUDED.target_result,
                     comparison_result = EXCLUDED.comparison_result,
                     completed_at = now()""",
                (
                    task_id,
                    schema_version,
                    json.dumps(reference, ensure_ascii=False),
                    json.dumps(target, ensure_ascii=False),
                    json.dumps(comparison, ensure_ascii=False),
                ),
            )
            return True

    def fail_measurement(self, task_id: str, error_code: str, role: str | None = None) -> None:
        with psycopg.connect(self.database_url) as connection:
            changed = connection.execute(
                """UPDATE color_tasks
                   SET status = 'measurement_failed', error_code = %s, updated_at = now()
                   WHERE id = %s AND status = 'measuring'
                   RETURNING id""",
                (error_code, task_id),
            ).fetchone()
            if changed is not None and role in ("reference", "target"):
                connection.execute(
                    """UPDATE task_upload_slots SET status = 'failed', error_code = %s, updated_at = now()
                       WHERE task_id = %s AND role = %s""",
                    (error_code, task_id, role),
                )

    def set_previews(self, task_id: str, reference_key: str, target_key: str) -> bool:
        with psycopg.connect(self.database_url) as connection:
            active = connection.execute(
                "SELECT 1 FROM color_tasks WHERE id = %s AND status = 'recognizing' FOR UPDATE",
                (task_id,),
            ).fetchone()
            if active is None:
                return False
            connection.execute(
                "UPDATE task_assets SET preview_object_key = %s WHERE task_id = %s AND role = 'reference'",
                (reference_key, task_id),
            )
            connection.execute(
                "UPDATE task_assets SET preview_object_key = %s WHERE task_id = %s AND role = 'target'",
                (target_key, task_id),
            )
            return True

    def complete(
        self,
        task_id: str,
        model: str,
        response_id: str | None,
        result: dict[str, Any],
    ) -> bool:
        with psycopg.connect(self.database_url) as connection:
            active = connection.execute(
                """UPDATE color_tasks
                   SET status = 'vision_ready', error_code = NULL, updated_at = now()
                   WHERE id = %s AND status = 'recognizing'
                   RETURNING id""",
                (task_id,),
            ).fetchone()
            if active is None:
                return False
            connection.execute(
                """INSERT INTO vision_analyses (task_id, model_name, provider_response_id, result, completed_at)
                   VALUES (%s, %s, %s, %s::jsonb, now())
                   ON CONFLICT (task_id) DO UPDATE SET
                     model_name = EXCLUDED.model_name,
                     provider_response_id = EXCLUDED.provider_response_id,
                     result = EXCLUDED.result,
                     completed_at = now()""",
                (task_id, model, response_id, json.dumps(result, ensure_ascii=False)),
            )
            return True

    def fail(self, task_id: str, error_code: str, role: str | None = None) -> None:
        with psycopg.connect(self.database_url) as connection:
            changed = connection.execute(
                """UPDATE color_tasks
                   SET status = 'vision_failed', error_code = %s, updated_at = now()
                   WHERE id = %s AND status = 'recognizing'
                   RETURNING id""",
                (error_code, task_id),
            ).fetchone()
            if changed is not None and role in ("reference", "target"):
                connection.execute(
                    """UPDATE task_upload_slots SET status = 'failed', error_code = %s, updated_at = now()
                       WHERE task_id = %s AND role = %s""",
                    (error_code, task_id, role),
                )
