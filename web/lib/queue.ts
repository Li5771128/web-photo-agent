import Redis from "ioredis";
import { getConfig } from "./config";

const globalForRedis = globalThis as unknown as { redis?: Redis };
function getRedis(): Redis {
  const client = globalForRedis.redis ?? new Redis(getConfig().REDIS_URL, { maxRetriesPerRequest: 2 });
  if (process.env.NODE_ENV !== "production") globalForRedis.redis = client;
  return client;
}

export const ANALYSIS_QUEUE = "reftone:analysis:pending";

export async function enqueueAnalysis(taskId: string): Promise<void> {
  await getRedis().lpush(ANALYSIS_QUEUE, JSON.stringify({ version: 1, taskId, enqueuedAt: new Date().toISOString() }));
}
