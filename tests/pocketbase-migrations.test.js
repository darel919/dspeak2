import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCollectionFields } from "../server/utils/pocketbase-migrations.js";
import { readFileSync } from "node:fs";

test("PocketBase migration field merging is idempotent and preserves IDs", () => {
  const current = [
    { id: "existing", name: "accent", type: "text", required: false },
    { id: "untouched", name: "name", type: "text", required: true },
  ];
  const additions = [
    { name: "accent", type: "select", values: ["cobalt"] },
    { name: "header_image", type: "file", maxSelect: 1 },
  ];
  const first = mergeCollectionFields(current, additions);
  const second = mergeCollectionFields(first, additions);
  assert.deepEqual(second, first);
  assert.equal(first[0].id, "existing");
  assert.equal(first[1].id, "untouched");
  assert.equal(first[2].name, "header_image");
});

test("PocketBase migration field merging preserves system field definitions", () => {
  const username = {
    id: "system-username",
    name: "username",
    type: "text",
    required: false,
    system: true,
    max: 0,
  };
  const merged = mergeCollectionFields(
    [username],
    [{ name: "username", type: "text", system: false, max: 120 }],
  );
  assert.deepEqual(merged, [username]);
});

test("PocketBase migrations enforce case-insensitive unique user handles", () => {
  const source = readFileSync(
    new URL("../server/utils/pocketbase-migrations.js", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /CREATE UNIQUE INDEX idx_users_handle_unique ON users \(handle COLLATE NOCASE\) WHERE handle != ''/,
  );
});

test("PocketBase migrations do not index multi-value relation fields", () => {
  const source = readFileSync(
    new URL("../server/utils/pocketbase-migrations.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /idx_dspeak_rooms_members/);
});

test("PocketBase migrations initialize and repair the complete database", () => {
  const migrations = readFileSync(
    new URL("../server/utils/pocketbase-migrations.js", import.meta.url),
    "utf8",
  );
  assert.match(
    migrations,
    /name: "20260724_foundation_v1"[\s\S]*run: migrateFoundation/,
  );
  for (const collection of [
    "users",
    "dspeak_rooms",
    "dspeak_rooms_channels",
    "dspeak_messages",
    "dspeak_webpush",
    "dspeak_webpush_global",
    "dspeak_users_state",
    "dspeak_room_roles",
    "dspeak_room_memberships",
    "dspeak_notifications",
    "dspeak_notification_preferences",
    "dspeak_room_notification_preferences",
    "dspeak_user_nicknames",
    "dspeak_room_soundboards",
    "dspeak_push_subscriptions",
    "dspeak_push_jobs",
    "dspeak_sessions",
    "dspeak_message_revisions",
    "dspeak_room_invites",
    "dspeak_room_audit_log",
  ])
    assert.match(
      migrations,
      new RegExp(`["']${collection}["']`),
      `${collection} must be part of the managed schema`,
    );
  assert.match(
    migrations,
    /if \(completed && !missingCollections\.length\) continue/,
  );
  assert.match(migrations, /const operation = completed \? "Repairing with"/);
});

test("PocketBase migrations add soundboard timestamps used for stable sorting", () => {
  const source = readFileSync(
    new URL("../server/utils/pocketbase-migrations.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /field\("created", "autodate"/);
  assert.match(source, /field\("updated", "autodate"/);
  assert.match(source, /20260723_soundboard_timestamps_v1/);
});

test("PocketBase permits the first soundboard clip to use display order zero", () => {
  const source = readFileSync(
    new URL("../server/utils/pocketbase-migrations.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /field\("display_order", "number", \{ min: 0 \}\)/);
  assert.doesNotMatch(
    source,
    /field\("display_order", "number", \{ required: true, min: 0 \}\)/,
  );
  assert.match(source, /20260723_soundboard_display_order_v1/);
});

test("PocketBase permits soundboard clips up to ten seconds", () => {
  const source = readFileSync(
    new URL("../server/utils/pocketbase-migrations.js", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /field\("duration", "number", \{ required: true, min: 0, max: 10 \}\)/,
  );
  assert.doesNotMatch(source, /duration.*max: 5/);
  assert.match(source, /20260723_soundboard_duration_10s_v1/);
});

test("PocketBase grants voice moderation to existing room admins", () => {
  const source = readFileSync(
    new URL("../server/utils/pocketbase-migrations.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /20260723_voice_moderation_permission_v1/);
  assert.match(source, /"channel\.moderate_voice"/);
});

test("PocketBase permits a new push job to start with zero attempts", () => {
  const source = readFileSync(
    new URL("../server/utils/pocketbase-migrations.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /field\("attempts", "number", \{ min: 0, max: 20 \}\)/);
  assert.doesNotMatch(
    source,
    /field\("attempts", "number", \{ required: true, min: 0, max: 20 \}\)/,
  );
  assert.match(source, /20260723_push_job_zero_attempts_v1/);
});
