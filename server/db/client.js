import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const runtimeUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_DATABASE_URL;

if (!runtimeUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const runtimeClient = postgres(runtimeUrl, {
  prepare: false,
  max: 1,
  ssl: runtimeUrl.includes("supabase.co") ? "require" : false,
});

export const directClient = directUrl
  ? postgres(directUrl, {
      prepare: false,
      max: 1,
      ssl: directUrl.includes("supabase.co") ? "require" : false,
    })
  : null;

export const db = drizzle(runtimeClient);

export const directDb = directClient ? drizzle(directClient) : null;

export async function closeDatabase() {
  await runtimeClient.end();
  if (directClient) await directClient.end();
}
