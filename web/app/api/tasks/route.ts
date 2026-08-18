import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getConfig } from "../../../lib/config";
import { getDatabase, transaction } from "../../../lib/database";
import { enqueueAnalysis } from "../../../lib/queue";
import { getOrCreateSession, setSessionCookie } from "../../../lib/session";
import { deleteObject, storeObject } from "../../../lib/storage";
import { UploadValidationError, validateUpload } from "../../../lib/uploads";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const storedKeys: string[] = [];
  let taskId: string | undefined;
  let taskPersisted = false;
  try {
    const maximumRequestBytes = getConfig().UPLOAD_MAX_BYTES * 2 + 1024 * 1024;
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maximumRequestBytes) {
      return NextResponse.json(
        { error: { code: "request_too_large", message: "上传内容超过允许大小，请压缩图片后重试。" } },
        { status: 413 },
      );
    }
    const form = await request.formData();
    const [reference, target] = await Promise.all([
      validateUpload(form.get("reference"), "参考图 A"),
      validateUpload(form.get("target"), "目标图 B"),
    ]);
    const session = await getOrCreateSession();
    taskId = randomUUID();
    const uploads = [{ role: "reference", file: reference }, { role: "target", file: target }] as const;

    for (const upload of uploads) {
      const key = `tasks/${taskId}/${upload.role}.${upload.file.extension}`;
      await storeObject(key, upload.file.buffer, upload.file.mediaType);
      storedKeys.push(key);
    }

    const expiresAt = new Date(Date.now() + getConfig().TASK_TTL_HOURS * 60 * 60 * 1000);
    await transaction(async (client) => {
      await client.query(
        "INSERT INTO color_tasks (id, session_hash, status, expires_at) VALUES ($1, $2, 'queued', $3)",
        [taskId, session.hash, expiresAt],
      );
      for (let index = 0; index < uploads.length; index += 1) {
        const upload = uploads[index];
        const file = upload.file;
        await client.query(
          `INSERT INTO task_assets (task_id, role, object_key, original_name, media_type, byte_size, width, height)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [taskId, upload.role, storedKeys[index], file.originalName, file.mediaType, file.byteSize, file.width, file.height],
        );
      }
    });
    taskPersisted = true;

    try { await enqueueAnalysis(taskId); }
    catch (error) {
      await getDatabase().query("UPDATE color_tasks SET status = 'queue_failed', error_code = 'queue_unavailable', updated_at = now() WHERE id = $1", [taskId]);
      throw error;
    }

    if (session.isNew) await setSessionCookie(session.token);
    return NextResponse.json({ id: taskId, status: "queued", workerReceivedAt: null, expiresAt: expiresAt.toISOString() }, { status: 201 });
  } catch (error) {
    if (!taskPersisted) await Promise.allSettled(storedKeys.map(deleteObject));
    if (error instanceof UploadValidationError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 422 });
    }
    console.error("task creation failed", { taskId, error });
    return NextResponse.json({ error: { code: "task_creation_failed", message: "临时任务创建失败，请稍后重试。" } }, { status: 503 });
  }
}
