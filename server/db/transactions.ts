import { db, directDb } from "./client.ts";

export type DatabaseTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

type TransactionCallback<T> = (tx: DatabaseTransaction) => T | Promise<T>;

export async function withTransaction<T>(
  fn: TransactionCallback<T>,
): Promise<T> {
  return db.transaction(async (tx) => fn(tx));
}

export async function withDirectTransaction<T>(
  fn: TransactionCallback<T>,
): Promise<T> {
  if (!directDb) throw new Error("DIRECT_DATABASE_URL not configured");
  return directDb.transaction(async (tx) => fn(tx));
}

export async function executeInTransaction<T>(
  database: typeof db,
  fn: TransactionCallback<T>,
): Promise<T> {
  return database.transaction(async (tx) => fn(tx));
}
