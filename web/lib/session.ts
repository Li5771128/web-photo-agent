import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getConfig } from "./config";

const COOKIE_NAME = "reftone_session";

export function hashSession(token: string): string {
  return createHash("sha256").update(`${getConfig().SESSION_SECRET}:${token}`).digest("hex");
}

export async function getOrCreateSession(): Promise<{ token: string; hash: string; isNew: boolean }> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(COOKIE_NAME)?.value;
  const token = existing ?? randomBytes(32).toString("base64url");
  return { token, hash: hashSession(token), isNew: !existing };
}

export async function setSessionCookie(token: string): Promise<void> {
  const config = getConfig();
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: config.TASK_TTL_HOURS * 60 * 60,
  });
}
