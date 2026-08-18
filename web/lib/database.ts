import { Pool, type PoolClient } from "pg";
import { getConfig } from "./config";

const globalForDatabase = globalThis as unknown as { database?: Pool };

export function getDatabase(): Pool {
  const pool = globalForDatabase.database ?? new Pool({ connectionString: getConfig().DATABASE_URL, max: 10 });
  if (process.env.NODE_ENV !== "production") globalForDatabase.database = pool;
  return pool;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDatabase().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
