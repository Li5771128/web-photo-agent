import { getOrCreateSession } from "../../../../../lib/session";
import { getXmpExportSource } from "../../../../../lib/tasks";
import { createXmpDownload, taskNotFoundResponse } from "../../../../../lib/xmp-download";
import { isTaskId } from "../../../../../lib/xmp";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  if (!isTaskId(taskId)) return taskNotFoundResponse();
  const session = await getOrCreateSession();
  return createXmpDownload(taskId, session.hash, getXmpExportSource);
}
