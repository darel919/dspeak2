import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("notification publishers and subscribers share the notify topic contract", async () => {
  const [dspeakRealtime, supabaseRealtime] = await Promise.all([
    read("server/utils/dspeak-realtime.js"),
    read("server/utils/supabase-realtime.js"),
  ]);

  assert.match(dspeakRealtime, /`notify:\$\{String\(userId\)\}`/);
  assert.match(supabaseRealtime, /`notify:\$\{normalizedUserId\}`/);
  assert.match(supabaseRealtime, /`notify:\$\{String\(userId\)\}`/);
  assert.doesNotMatch(supabaseRealtime, /`notifications:/);
});

test("the executable realtime migration is idempotent and matches the schema", async () => {
  const [migration, setup] = await Promise.all([
    read("drizzle/migrations/0000_modern_lake.sql"),
    read("server/db/realtime-rls.sql"),
  ]);

  for (const sql of [migration, setup]) {
    assert.match(sql, /pg_publication_tables/);
    assert.match(sql, /drop policy if exists "dspeak_realtime_read"/i);
    assert.match(sql, /create policy "dspeak_realtime_read"/i);
    assert.match(sql, /from public\.room_memberships rm/i);
    assert.match(sql, /join public\.channels c on c\.room_id = rm\.room_id/i);
    assert.match(sql, /topic like 'notify:%'/i);
    assert.doesNotMatch(sql, /public\.channel_members/);
  }
});
