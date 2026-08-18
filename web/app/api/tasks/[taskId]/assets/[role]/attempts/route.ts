import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDatabase } from "../../../../../../../lib/database";
import { getOrCreateSession } from "../../../../../../../lib/session";
import type { AssetRole } from "../../../../../../../lib/uploads";

export const runtime = "nodejs";

function assetRole(value: string): AssetRole | null {
  return value === "reference" || value === "target" ? value : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string; role: string }> },
) {
  const session = await getOrCreateSession();
  const { taskId, role: roleValue } = await params;
  const role = assetRole(roleValue);
  if (!role) return NextResponse.json({ error: { code: "invalid_role", message: "图片角色无效。" } }, { status: 400 });
  const generation = Number(request.headers.get("x-upload-generation"));
  if (!Number.isInteger(generation) || generation <= 0) {
    return NextResponse.json({ error: { code: "invalid_upload_generation", message: "上传版本无效，请重新选择图片。" } }, { status: 400 });
  }

  const attemptId = randomUUID();
  const result = await getDatabase().query(
    `UPDATE task_upload_slots s
     SET current_attempt_id = $1, generation = $5, status = 'uploading', error_code = NULL, updated_at = now()
     FROM color_tasks t
     WHERE s.task_id = $2 AND s.role = $3 AND t.id = s.task_id
       AND t.session_hash = $4 AND t.status = 'collecting' AND t.expires_at > now()
       AND s.generation < $5
     RETURNING s.task_id`,
    [attemptId, taskId, role, session.hash, generation],
  );
  if (result.rowCount !== 1) {
    return NextResponse.json(
      { error: { code: "task_locked", message: "当前任务已开始分析，请先确认换图并创建新任务。" } },
      { status: 409 },
    );
  }
  return NextResponse.json({ attemptId, role }, { status: 201 });
}
