import { NextResponse } from "next/server";
import { getDatabase, transaction } from "../../../../lib/database";
import { getOrCreateSession } from "../../../../lib/session";
import { deleteObject } from "../../../../lib/storage";
import { getTaskSnapshot } from "../../../../lib/tasks";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await getOrCreateSession();
  const { taskId } = await params;
  const task = await getTaskSnapshot(taskId, session.hash);
  if (!task) return NextResponse.json({ error: { code: "task_not_found", message: "任务不存在或已过期。" } }, { status: 404 });
  return NextResponse.json(task);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await getOrCreateSession();
  const { taskId } = await params;
  const keys = await transaction(async (client) => {
    const task = await client.query(
      `UPDATE color_tasks
       SET status = 'cancelled', error_code = NULL, updated_at = now()
       WHERE id = $1 AND session_hash = $2 AND expires_at > now() AND status <> 'expired'
       RETURNING id`,
      [taskId, session.hash],
    );
    if (task.rowCount !== 1) return null;
    const assets = await client.query(
      "SELECT object_key, preview_object_key FROM task_assets WHERE task_id = $1",
      [taskId],
    );
    return assets.rows.flatMap((row) => [row.object_key, row.preview_object_key].filter(Boolean) as string[]);
  });
  if (keys === null) return NextResponse.json({ error: { code: "task_not_found", message: "任务不存在或已过期。" } }, { status: 404 });

  const cleanup = await Promise.allSettled(keys.map(deleteObject));
  if (cleanup.some((result) => result.status === "rejected")) {
    await getDatabase().query(
      "UPDATE color_tasks SET error_code = 'cleanup_pending', updated_at = now() WHERE id = $1 AND status = 'cancelled'",
      [taskId],
    );
  }
  return NextResponse.json({ id: taskId, status: "cancelled" });
}
