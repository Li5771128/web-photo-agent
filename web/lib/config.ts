import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  SESSION_SECRET: z.string().min(16),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  TASK_TTL_HOURS: z.coerce.number().int().positive().default(24),
});

export type AppConfig = z.infer<typeof schema>;

let parsedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  parsedConfig ??= schema.parse(process.env);
  return parsedConfig;
}
