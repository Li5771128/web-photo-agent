import { NextResponse } from "next/server";
import { getDatabase } from "../../../../lib/database";
import { getOrCreateSession } from "../../../../lib/session";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await getOrCreateSession();
  const { taskId } = await params;
  const result = await getDatabase().query(
    `SELECT t.id, t.status, t.error_code AS "errorCode",
            t.worker_received_at AS "workerReceivedAt", t.expires_at AS "expiresAt",
            v.model_name AS "visionModel", v.result AS "visionResult"
     FROM color_tasks t
     LEFT JOIN vision_analyses v ON v.task_id = t.id
     WHERE t.id = $1 AND t.session_hash = $2 AND t.expires_at > now()`,
    [taskId, session.hash],
  );
  if (result.rowCount !== 1) return NextResponse.json({ error: { code: "task_not_found", message: "任务不存在或已过期。" } }, { status: 404 });
  return NextResponse.json(result.rows[0]);
}
