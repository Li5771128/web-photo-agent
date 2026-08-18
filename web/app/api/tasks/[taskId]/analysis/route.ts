import { NextResponse } from "next/server";
import { getDatabase, transaction } from "../../../../../lib/database";
import { enqueueAnalysis, enqueuePlanning } from "../../../../../lib/queue";
import { getOrCreateSession } from "../../../../../lib/session";

export const runtime = "nodejs";

class AnalysisNotReadyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await getOrCreateSession();
  const { taskId } = await params;

  try {
    const result = await transaction(async (client) => {
      const task = await client.query(
        `SELECT status FROM color_tasks
         WHERE id = $1 AND session_hash = $2 AND expires_at > now()
         FOR UPDATE`,
        [taskId, session.hash],
      );
      if (task.rowCount !== 1) throw new AnalysisNotReadyError("task_not_found", "任务不存在或已过期。");
      const status = task.rows[0].status as string;
      if (["queued", "measuring", "recognizing", "planning", "validating", "ready"].includes(status)) return { status, shouldEnqueue: false, kind: "analyze" as const };
      if (["vision_ready", "planning_failed", "validation_failed"].includes(status)) {
        const planning = await client.query(
          `UPDATE color_tasks SET status = 'planning', error_code = NULL, updated_at = now()
           WHERE id = $1 AND status IN ('vision_ready', 'planning_failed', 'validation_failed')
           RETURNING status`,
          [taskId],
        );
        return { status: planning.rows[0]?.status ?? status, shouldEnqueue: planning.rowCount === 1, kind: "plan" as const };
      }
      if (!["collecting", "queue_failed"].includes(status)) {
        throw new AnalysisNotReadyError("task_not_confirmable", "当前任务无法开始分析，请重新开始。");
      }

      const assets = await client.query(
        `SELECT s.role, s.status, a.is_raw, a.preview_object_key
         FROM task_upload_slots s
         LEFT JOIN task_assets a ON a.task_id = s.task_id AND a.role = s.role
         WHERE s.task_id = $1
         ORDER BY s.role
         FOR UPDATE OF s`,
        [taskId],
      );
      if (assets.rowCount !== 2 || assets.rows.some((asset) => asset.status !== "confirmed")) {
        throw new AnalysisNotReadyError("assets_not_ready", "请先完成参考图 A 和目标图 B 的上传。");
      }
      if (assets.rows.some((asset) => asset.is_raw && !asset.preview_object_key)) {
        throw new AnalysisNotReadyError("preview_not_ready", "RAW 预览仍在生成，请稍候。");
      }

      const queued = await client.query(
        `UPDATE color_tasks SET status = 'queued', error_code = NULL, updated_at = now()
         WHERE id = $1 AND status IN ('collecting', 'queue_failed')
         RETURNING status`,
        [taskId],
      );
      return { status: queued.rows[0]?.status ?? status, shouldEnqueue: queued.rowCount === 1, kind: "analyze" as const };
    });

    if (result.shouldEnqueue) {
      try { await (result.kind === "plan" ? enqueuePlanning(taskId) : enqueueAnalysis(taskId)); }
      catch (error) {
        await getDatabase().query(
          `UPDATE color_tasks
           SET status = CASE WHEN status = 'planning' THEN 'planning_failed' ELSE 'queue_failed' END,
               error_code = 'queue_unavailable', updated_at = now()
           WHERE id = $1 AND status IN ('queued', 'planning')`,
          [taskId],
        );
        console.error("analysis enqueue failed", { taskId, error });
        return NextResponse.json(
          { error: { code: "queue_unavailable", message: "任务队列暂时不可用，请稍后重试。" } },
          { status: 503 },
        );
      }
    }
    return NextResponse.json({ id: taskId, status: result.status });
  } catch (error) {
    if (error instanceof AnalysisNotReadyError) {
      const status = error.code === "task_not_found" ? 404 : 409;
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
    }
    console.error("analysis confirmation failed", { taskId, error });
    return NextResponse.json(
      { error: { code: "analysis_confirmation_failed", message: "暂时无法开始分析，请稍后重试。" } },
      { status: 503 },
    );
  }
}
