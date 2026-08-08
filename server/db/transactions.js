import { runtimeClient, directClient } from "./client.js";

export async function withTransaction(fn) {
  return runtimeClient.begin(async (tx) => {
    const txDb = (await import("drizzle-orm/postgres-js")).drizzle(tx);
    return fn(txDb);
  });
}

export async function withDirectTransaction(fn) {
  if (!directClient) throw new Error("DIRECT_DATABASE_URL not configured");
  return directClient.begin(async (tx) => {
    const txDb = (await import("drizzle-orm/postgres-js")).drizzle(tx);
    return fn(txDb);
  });
}

export async function executeInTransaction(client, fn) {
  return client.begin(async (tx) => {
    const txDb = (await import("drizzle-orm/postgres-js")).drizzle(tx);
    return fn(txDb);
  });
}
