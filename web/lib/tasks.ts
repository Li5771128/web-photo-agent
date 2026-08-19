import { randomUUID } from "node:crypto";
import { getDatabase, transaction } from "./database";

export type TaskStatus = "collecting" | "queued" | "queue_failed" | "measuring" | "measurement_failed" | "recognizing" | "vision_ready" | "vision_failed" | "planning" | "planning_failed" | "validating" | "validation_failed" | "ready" | "cancelled" | "expired";

export async function createTask(sessionHash: string, ttlHours: number): Promise<{ id: string; expiresAt: Date }> {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await transaction(async (client) => {
    await client.query(
      "INSERT INTO color_tasks (id, session_hash, status, expires_at) VALUES ($1, $2, 'collecting', $3)",
      [id, sessionHash, expiresAt],
    );
    await client.query(
      "INSERT INTO task_upload_slots (task_id, role) VALUES ($1, 'reference'), ($1, 'target')",
      [id],
    );
  });
  return { id, expiresAt };
}

export async function getTaskSnapshot(taskId: string, sessionHash: string): Promise<Record<string, unknown> | null> {
  const result = await getDatabase().query(
    `SELECT t.id, t.status, t.error_code AS "errorCode",
            t.worker_received_at AS "workerReceivedAt", t.expires_at AS "expiresAt",
            v.model_name AS "visionModel", v.result AS "visionResult",
            p.safe_plan AS "lightroomPlan",
            CASE WHEN m.task_id IS NULL THEN NULL ELSE jsonb_build_object(
              'schemaVersion', m.schema_version,
              'reference', m.reference_result,
              'target', m.target_result,
              'comparison', m.comparison_result,
              'completedAt', m.completed_at
            ) END AS measurements,
            COALESCE(
              jsonb_object_agg(
                s.role,
                jsonb_build_object(
                  'status', s.status,
                  'errorCode', s.error_code,
                  'originalName', a.original_name,
                  'mediaType', a.media_type,
                  'isRaw', COALESCE(a.is_raw, false),
                  'previewReady', a.preview_object_key IS NOT NULL
                )
              ) FILTER (WHERE s.role IS NOT NULL),
              '{}'::jsonb
            ) AS assets
     FROM color_tasks t
     LEFT JOIN task_upload_slots s ON s.task_id = t.id
     LEFT JOIN task_assets a ON a.task_id = t.id AND a.role = s.role
     LEFT JOIN vision_analyses v ON v.task_id = t.id
     LEFT JOIN image_measurements m ON m.task_id = t.id
     LEFT JOIN lightroom_plans p ON p.task_id = t.id
     WHERE t.id = $1 AND t.session_hash = $2 AND t.expires_at > now()
     GROUP BY t.id, v.model_name, v.result, p.safe_plan, m.task_id, m.schema_version, m.reference_result,
              m.target_result, m.comparison_result, m.completed_at`,
    [taskId, sessionHash],
  );
  return result.rowCount === 1 ? result.rows[0] : null;
}

export async function taskBelongsToSession(taskId: string, sessionHash: string): Promise<boolean> {
  const result = await getDatabase().query(
    "SELECT 1 FROM color_tasks WHERE id = $1 AND session_hash = $2 AND expires_at > now()",
    [taskId, sessionHash],
  );
  return result.rowCount === 1;
}

export async function getXmpExportSource(
  taskId: string,
  sessionHash: string,
): Promise<{ status: TaskStatus; safePlan: unknown | null } | null> {
  const result = await getDatabase().query(
    `SELECT t.status, p.safe_plan AS "safePlan"
     FROM color_tasks t
     LEFT JOIN lightroom_plans p ON p.task_id = t.id
     WHERE t.id = $1 AND t.session_hash = $2 AND t.expires_at > now()`,
    [taskId, sessionHash],
  );
  return result.rowCount === 1 ? result.rows[0] : null;
}
