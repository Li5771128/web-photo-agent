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
                "SELECT role, object_key FROM task_assets WHERE task_id = %s",
                (task_id,),
            ).fetchall()
            assets = {row["role"]: row["object_key"] for row in rows}
            if "reference" not in assets or "target" not in assets:
                connection.execute(
                    "UPDATE color_tasks SET status = 'vision_failed', error_code = 'vision_asset_unavailable', updated_at = now() WHERE id = %s",
                    (task_id,),
                )
                return None
            return TaskAssets(task_id, assets["reference"], assets["target"])

    def complete(
        self,
        task_id: str,
        model: str,
        response_id: str | None,
        result: dict[str, Any],
    ) -> None:
        with psycopg.connect(self.database_url) as connection:
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
            connection.execute(
                "UPDATE color_tasks SET status = 'vision_ready', error_code = NULL, updated_at = now() WHERE id = %s AND status = 'recognizing'",
                (task_id,),
            )

    def fail(self, task_id: str, error_code: str) -> None:
        with psycopg.connect(self.database_url) as connection:
            connection.execute(
                """UPDATE color_tasks
                   SET status = 'vision_failed', error_code = %s, updated_at = now()
                   WHERE id = %s AND status = 'recognizing'""",
                (error_code, task_id),
            )
