import { Pool } from "pg";
import { CLOUD_SCHEMA } from "./schema.ts";

export type Query = {
  query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export function createCloudPool(connectionString: string) {
  return new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    options: `-c search_path=${CLOUD_SCHEMA} -c statement_timeout=15000 -c lock_timeout=5000`,
  });
}

export async function transaction<T>(pool: Pool, work: (db: Query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
