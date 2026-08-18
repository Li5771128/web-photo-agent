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
                   SET status = 'recognizing', worker_received_at = COALESCE(worker_received_at, now()),
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
                    """UPDATE color_tasks SET status = 'vision_failed', error_code = 'vision_asset_unavailable', updated_at = now()
                       WHERE id = %s AND status = 'recognizing'""",
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
