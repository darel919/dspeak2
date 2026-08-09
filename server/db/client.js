import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const runtimeUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_DATABASE_URL;

function poolSize(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 20) return fallback;
  return value;
}

if (!runtimeUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const runtimeClient = postgres(runtimeUrl, {
  prepare: false,
  max: poolSize("DATABASE_POOL_MAX", 10),
  ssl: runtimeUrl.includes("supabase.co") ? "require" : false,
});

export const directClient = directUrl
  ? postgres(directUrl, {
      prepare: false,
      max: poolSize("DIRECT_DATABASE_POOL_MAX", 2),
      ssl: directUrl.includes("supabase.co") ? "require" : false,
    })
  : null;

export const db = drizzle(runtimeClient);

export const directDb = directClient ? drizzle(directClient) : null;

export async function closeDatabase() {
  await runtimeClient.end();
  if (directClient) await directClient.end();
}
