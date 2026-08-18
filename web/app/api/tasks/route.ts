import { NextResponse } from "next/server";
import { getConfig } from "../../../lib/config";
import { getOrCreateSession, setSessionCookie } from "../../../lib/session";
import { createTask } from "../../../lib/tasks";

export const runtime = "nodejs";

export async function POST() {
  try {
    const session = await getOrCreateSession();
    const task = await createTask(session.hash, getConfig().TASK_TTL_HOURS);
    if (session.isNew) await setSessionCookie(session.token);
    return NextResponse.json({
      id: task.id,
      status: "collecting",
      workerReceivedAt: null,
      expiresAt: task.expiresAt.toISOString(),
      assets: {
        reference: { status: "empty", errorCode: null },
        target: { status: "empty", errorCode: null },
      },
    }, { status: 201 });
  } catch (error) {
    console.error("task creation failed", { error });
    return NextResponse.json(
      { error: { code: "task_creation_failed", message: "临时任务创建失败，请稍后重试。" } },
      { status: 503 },
    );
  }
}
