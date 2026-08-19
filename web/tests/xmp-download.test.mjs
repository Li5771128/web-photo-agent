import assert from "node:assert/strict";
import test from "node:test";
import { createXmpDownload } from "../lib/xmp-download.ts";

const taskId = "123e4567-e89b-12d3-a456-426614174000";
const safePlan = {
  schema_version: 1,
  validator_version: "1.1",
  style_name: "安全起始配方",
  parameters: [
    { key: "exposure", value: -0.3 }, { key: "contrast", value: 5 },
    { key: "highlights", value: -20 }, { key: "shadows", value: 15 },
    { key: "whites", value: 4 }, { key: "blacks", value: -6 },
    { key: "temperature", value: 12 }, { key: "tint", value: 5 },
  ],
};

test("rejects malformed task ids before loading an export source", async () => {
  let called = false;
  const response = await createXmpDownload("not-a-uuid", "session-hash", async () => { called = true; return null; });
  assert.equal(response.status, 404);
  assert.equal(called, false);
  assert.deepEqual(await response.json(), { error: { code: "task_not_found", message: "任务不存在或已过期。" } });
});

test("passes task and session ownership to the source loader and hides unavailable plans", async () => {
  const missing = await createXmpDownload(taskId, "owned-session", async (receivedTaskId, receivedSessionHash) => {
    assert.equal(receivedTaskId, taskId);
    assert.equal(receivedSessionHash, "owned-session");
    return null;
  });
  assert.equal(missing.status, 404);

  for (const source of [{ status: "planning", safePlan }, { status: "ready", safePlan: null }]) {
    const response = await createXmpDownload(taskId, "owned-session", async () => source);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "xmp_plan_unavailable");
  }
});

test("returns a private attachment only for a ready safe plan", async () => {
  const response = await createXmpDownload(taskId, "owned-session", async () => ({ status: "ready", safePlan }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(response.headers.get("Content-Type"), /^application\/rdf\+xml/);
  assert.match(response.headers.get("Content-Disposition"), /^attachment;/);
  const xml = await response.text();
  assert.match(xml, /crs:Exposure2012="-0.3"/);
  assert.doesNotMatch(xml, /WhiteBalance|IncrementalTemperature|IncrementalTint/);
});
