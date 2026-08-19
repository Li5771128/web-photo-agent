import { generateLightroomPreset, isTaskId, xmpContentDisposition, xmpFilename, XmpExportError } from "./xmp.ts";

type ExportSource = { status: string; safePlan: unknown | null } | null;
export type XmpExportSourceLoader = (taskId: string, sessionHash: string) => Promise<ExportSource>;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function taskNotFoundResponse(): Response {
  return errorResponse(404, "task_not_found", "任务不存在或已过期。");
}

export async function createXmpDownload(
  taskId: string,
  sessionHash: string,
  loadSource: XmpExportSourceLoader,
): Promise<Response> {
  if (!isTaskId(taskId)) return taskNotFoundResponse();
  const source = await loadSource(taskId, sessionHash);
  if (!source) return taskNotFoundResponse();
  if (source.status !== "ready" || !source.safePlan) {
    return errorResponse(409, "xmp_plan_unavailable", "安全参数计划尚未完成，暂时不能导出 XMP。");
  }

  try {
    const generated = generateLightroomPreset({ taskId, plan: source.safePlan });
    return new Response(generated.xml, {
      headers: {
        "Content-Type": "application/rdf+xml; charset=utf-8",
        "Content-Disposition": xmpContentDisposition(xmpFilename(generated.presetName)),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof XmpExportError) return errorResponse(422, "xmp_export_failed", error.message);
    console.error("Unexpected XMP export failure", { taskId, error });
    return errorResponse(500, "xmp_export_failed", "XMP 导出失败，请稍后重试。");
  }
}
