import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl:
    config.databaseUrl.includes("localhost") || config.databaseUrl.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false }
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
) {
  return pool.query<T>(text, params);
}
