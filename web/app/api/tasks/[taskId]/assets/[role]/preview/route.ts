import { NextResponse } from "next/server";
import { getDatabase } from "../../../../../../../lib/database";
import { getOrCreateSession } from "../../../../../../../lib/session";
import { readObject } from "../../../../../../../lib/storage";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string; role: string }> },
) {
  const session = await getOrCreateSession();
  const { taskId, role } = await params;
  if (role !== "reference" && role !== "target") {
    return NextResponse.json({ error: { code: "invalid_role", message: "图片角色无效。" } }, { status: 400 });
  }
  const result = await getDatabase().query(
    `SELECT a.preview_object_key
     FROM task_assets a
     JOIN color_tasks t ON t.id = a.task_id
     WHERE a.task_id = $1 AND a.role = $2 AND t.session_hash = $3
       AND t.expires_at > now() AND a.preview_object_key IS NOT NULL`,
    [taskId, role, session.hash],
  );
  if (result.rowCount !== 1) return new NextResponse(null, { status: 404 });
  try {
    const object = await readObject(result.rows[0].preview_object_key);
    return new NextResponse(Buffer.from(object.body), {
      headers: { "Content-Type": object.contentType, "Cache-Control": "private, no-store" },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
