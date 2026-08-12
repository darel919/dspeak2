import { runtimeClient, directClient } from "./client.ts";
import { db } from "./client.ts";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";

export async function withTransaction<T>(
  fn: (tx: typeof db) => T | Promise<T>,
): Promise<T> {
  const result = await runtimeClient.begin<T>(async (tx) => {
    const txDb = drizzle(tx as unknown as Sql);
    return fn(txDb);
  });
  return result as T;
}

export async function withDirectTransaction<T>(
  fn: (tx: typeof db) => T | Promise<T>,
): Promise<T> {
  if (!directClient) throw new Error("DIRECT_DATABASE_URL not configured");
  const result = await directClient.begin<T>(async (tx) => {
    const txDb = drizzle(tx as unknown as Sql);
    return fn(txDb);
  });
  return result as T;
}

export async function executeInTransaction<T>(
  client: typeof runtimeClient,
  fn: (tx: typeof db) => T | Promise<T>,
): Promise<T> {
  const result = await client.begin<T>(async (tx) => {
    const txDb = drizzle(tx as unknown as Sql);
    return fn(txDb);
  });
  return result as T;
}
