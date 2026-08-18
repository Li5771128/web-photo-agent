import { NextResponse } from "next/server";
import { getConfig } from "../../../../../../../../lib/config";
import { getDatabase, transaction } from "../../../../../../../../lib/database";
import { enqueueAnalysis } from "../../../../../../../../lib/queue";
import { getOrCreateSession } from "../../../../../../../../lib/session";
import { deleteObject, storeObject } from "../../../../../../../../lib/storage";
import { UploadValidationError, validateUpload, type AssetRole } from "../../../../../../../../lib/uploads";

export const runtime = "nodejs";

class UploadSupersededError extends Error {}

function assetRole(value: string): AssetRole | null {
  return value === "reference" || value === "target" ? value : null;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ taskId: string; role: string; attemptId: string }> },
) {
  const session = await getOrCreateSession();
  const { taskId, role: roleValue, attemptId } = await params;
  const role = assetRole(roleValue);
  if (!role) return NextResponse.json({ error: { code: "invalid_role", message: "图片角色无效。" } }, { status: 400 });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > getConfig().RAW_UPLOAD_MAX_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: { code: "file_too_large", message: "上传内容超过允许大小。" } }, { status: 413 });
  }

  let objectKey: string | null = null;
  try {
    const form = await request.formData();
    const label = role === "reference" ? "参考图 A" : "目标图 B";
    const upload = await validateUpload(form.get("file"), label, role);
    objectKey = `tasks/${taskId}/${role}/${attemptId}.${upload.extension}`;
    await storeObject(objectKey, upload.buffer, upload.mediaType);

    const result = await transaction(async (client) => {
      const slot = await client.query(
        `SELECT s.current_attempt_id, t.status
         FROM task_upload_slots s
         JOIN color_tasks t ON t.id = s.task_id
         WHERE s.task_id = $1 AND s.role = $2 AND t.session_hash = $3 AND t.expires_at > now()
         FOR UPDATE OF s, t`,
        [taskId, role, session.hash],
      );
      if (slot.rowCount !== 1 || slot.rows[0].status !== "collecting" || slot.rows[0].current_attempt_id !== attemptId) {
        throw new UploadSupersededError();
      }

      const previous = await client.query(
        "SELECT object_key, preview_object_key FROM task_assets WHERE task_id = $1 AND role = $2",
        [taskId, role],
      );
      await client.query(
        `INSERT INTO task_assets
           (task_id, role, object_key, original_name, media_type, byte_size, width, height, is_raw, preview_object_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)
         ON CONFLICT (task_id, role) DO UPDATE SET
           object_key = EXCLUDED.object_key,
           original_name = EXCLUDED.original_name,
           media_type = EXCLUDED.media_type,
           byte_size = EXCLUDED.byte_size,
           width = EXCLUDED.width,
           height = EXCLUDED.height,
           is_raw = EXCLUDED.is_raw,
           preview_object_key = NULL,
           created_at = now()`,
        [taskId, role, objectKey, upload.originalName, upload.mediaType, upload.byteSize, upload.width, upload.height, upload.isRaw],
      );
      await client.query(
        `UPDATE task_upload_slots
         SET status = 'confirmed', error_code = NULL, updated_at = now()
         WHERE task_id = $1 AND role = $2 AND current_attempt_id = $3`,
        [taskId, role, attemptId],
      );
      const confirmed = await client.query(
        "SELECT count(*)::int AS count FROM task_upload_slots WHERE task_id = $1 AND status = 'confirmed'",
        [taskId],
      );
      let shouldEnqueue = false;
      if (confirmed.rows[0].count === 2) {
        const queued = await client.query(
          "UPDATE color_tasks SET status = 'queued', error_code = NULL, updated_at = now() WHERE id = $1 AND status = 'collecting' RETURNING id",
          [taskId],
        );
        shouldEnqueue = queued.rowCount === 1;
      }
      return {
        shouldEnqueue,
        previousKeys: previous.rowCount === 1
          ? [previous.rows[0].object_key, previous.rows[0].preview_object_key].filter(Boolean) as string[]
          : [],
      };
    });

    await Promise.allSettled(result.previousKeys.filter((key) => key !== objectKey).map(deleteObject));
    let status = result.shouldEnqueue ? "queued" : "collecting";
    if (result.shouldEnqueue) {
      try { await enqueueAnalysis(taskId); }
      catch (error) {
        status = "queue_failed";
        await getDatabase().query(
          "UPDATE color_tasks SET status = 'queue_failed', error_code = 'queue_unavailable', updated_at = now() WHERE id = $1 AND status = 'queued'",
          [taskId],
        );
        console.error("analysis enqueue failed", { taskId, error });
      }
    }
    return NextResponse.json({ role, status, isRaw: upload.isRaw, previewReady: false });
  } catch (error) {
    if (objectKey) await deleteObject(objectKey).catch(() => undefined);
    if (error instanceof UploadValidationError) {
      await getDatabase().query(
        `UPDATE task_upload_slots s SET status = 'failed', error_code = $1, updated_at = now()
         FROM color_tasks t
         WHERE s.task_id = $2 AND s.role = $3 AND s.current_attempt_id = $4
           AND t.id = s.task_id AND t.session_hash = $5 AND t.status = 'collecting'`,
        [error.code, taskId, role, attemptId, session.hash],
      );
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 422 });
    }
    if (error instanceof UploadSupersededError) {
      return NextResponse.json({ error: { code: "upload_superseded", message: "该上传已被新的图片替换。" } }, { status: 409 });
    }
    console.error("asset upload failed", { taskId, role, attemptId, error });
    return NextResponse.json({ error: { code: "upload_failed", message: "图片上传失败，请重试。" } }, { status: 503 });
  }
}
