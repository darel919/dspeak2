import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./server/db/schema/index.js",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
