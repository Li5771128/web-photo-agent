import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getConfig } from "../../../../../lib/config";
import { getDatabase, transaction } from "../../../../../lib/database";
import { getOrCreateSession } from "../../../../../lib/session";
import { copyObject, deleteObject } from "../../../../../lib/storage";
import type { AssetRole } from "../../../../../lib/uploads";

export const runtime = "nodejs";

function assetRole(value: unknown): AssetRole | null {
  return value === "reference" || value === "target" ? value : null;
}

function extensionOfKey(key: string): string {
  const extension = key.split(".").pop();
  return extension && /^[a-z0-9]+$/i.test(extension) ? extension : "bin";
}

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await getOrCreateSession();
  const { taskId } = await params;
  const body = await request.json().catch(() => null) as { replaceRole?: unknown } | null;
  const replaceRole = assetRole(body?.replaceRole);
  if (!replaceRole) return NextResponse.json({ error: { code: "invalid_role", message: "请选择要更换的图片。" } }, { status: 400 });
  const retainedRole: AssetRole = replaceRole === "reference" ? "target" : "reference";

  const source = await getDatabase().query(
    `SELECT t.status, a.object_key, a.preview_object_key, a.original_name, a.media_type,
            a.byte_size, a.width, a.height, a.is_raw
     FROM color_tasks t
     JOIN task_assets a ON a.task_id = t.id AND a.role = $3
     WHERE t.id = $1 AND t.session_hash = $2 AND t.expires_at > now()
       AND t.status IN ('queued', 'queue_failed', 'recognizing', 'vision_ready', 'vision_failed')`,
    [taskId, session.hash, retainedRole],
  );
  if (source.rowCount !== 1) {
    return NextResponse.json(
      { error: { code: "task_not_replaceable", message: "当前任务无法单独换图，请重新开始。" } },
      { status: 409 },
    );
  }

  const sourceAsset = source.rows[0];
  const newTaskId = randomUUID();
  const newObjectKey = `tasks/${newTaskId}/${retainedRole}/retained.${extensionOfKey(sourceAsset.object_key)}`;
  const newPreviewKey = sourceAsset.preview_object_key ? `tasks/${newTaskId}/previews/${retainedRole}.jpg` : null;
  const copiedKeys: string[] = [];
  try {
    await copyObject(sourceAsset.object_key, newObjectKey);
    copiedKeys.push(newObjectKey);
    if (newPreviewKey) {
      await copyObject(sourceAsset.preview_object_key, newPreviewKey);
      copiedKeys.push(newPreviewKey);
    }

    const expiresAt = new Date(Date.now() + getConfig().TASK_TTL_HOURS * 60 * 60 * 1000);
    const oldKeys = await transaction(async (client) => {
      const oldTask = await client.query(
        `SELECT status FROM color_tasks
         WHERE id = $1 AND session_hash = $2 AND expires_at > now()
           AND status IN ('queued', 'queue_failed', 'recognizing', 'vision_ready', 'vision_failed')
         FOR UPDATE`,
        [taskId, session.hash],
      );
      if (oldTask.rowCount !== 1) throw new Error("task no longer replaceable");
      await client.query(
        "INSERT INTO color_tasks (id, session_hash, status, expires_at) VALUES ($1, $2, 'collecting', $3)",
        [newTaskId, session.hash, expiresAt],
      );
      await client.query(
        `INSERT INTO task_upload_slots (task_id, role, status)
         VALUES ($1, $2, 'confirmed'), ($1, $3, 'empty')`,
        [newTaskId, retainedRole, replaceRole],
      );
      await client.query(
        `INSERT INTO task_assets
           (task_id, role, object_key, original_name, media_type, byte_size, width, height, is_raw, preview_object_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          newTaskId, retainedRole, newObjectKey, sourceAsset.original_name, sourceAsset.media_type,
          sourceAsset.byte_size, sourceAsset.width, sourceAsset.height, sourceAsset.is_raw, newPreviewKey,
        ],
      );
      await client.query(
        "UPDATE color_tasks SET status = 'cancelled', error_code = NULL, updated_at = now() WHERE id = $1",
        [taskId],
      );
      const assets = await client.query(
        "SELECT object_key, preview_object_key FROM task_assets WHERE task_id = $1",
        [taskId],
      );
      return assets.rows.flatMap((row) => [row.object_key, row.preview_object_key].filter(Boolean) as string[]);
    });
    const cleanup = await Promise.allSettled(oldKeys.map(deleteObject));
    if (cleanup.some((result) => result.status === "rejected")) {
      await getDatabase().query(
        "UPDATE color_tasks SET error_code = 'cleanup_pending', updated_at = now() WHERE id = $1 AND status = 'cancelled'",
        [taskId],
      );
    }
    return NextResponse.json({
      id: newTaskId,
      status: "collecting",
      expiresAt: expiresAt.toISOString(),
      retainedRole,
      replaceRole,
    }, { status: 201 });
  } catch (error) {
    await Promise.allSettled(copiedKeys.map(deleteObject));
    console.error("task replacement failed", { taskId, replaceRole, error });
    return NextResponse.json(
      { error: { code: "task_replacement_failed", message: "换图任务创建失败，原任务仍然保留。" } },
      { status: 503 },
    );
  }
}
