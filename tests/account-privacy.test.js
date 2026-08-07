import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [auth, exportRoute, deleteRoute, inlineTokens] = await Promise.all(
  [
    "../server/utils/auth.js",
    "../server/routes/api/account/export.get.js",
    "../server/routes/api/account/delete.post.js",
    "../app/components/InlineTokens.vue",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);

test("account export reads complete records with Drizzle repositories", () => {
  assert.match(exportRoute, /db\.select/);
  assert.match(exportRoute, /account-export/);
  assert.match(exportRoute, /Cache-Control.*private, no-store/);
  assert.match(exportRoute, /from\(messages\)/);
  assert.match(exportRoute, /from\(notifications\)/);
  assert.match(exportRoute, /pushJobs/);
  assert.doesNotMatch(exportRoute, /getFullList/);
  assert.doesNotMatch(exportRoute, /PocketBase/);
});

test("account deletion preserves required message senders and uses Drizzle", () => {
  assert.match(deleteRoute, /content: "\[deleted\]"/);
  assert.doesNotMatch(deleteRoute, /sender:\s*null/);
  assert.match(deleteRoute, /disconnectVoiceParticipant/);
  assert.match(deleteRoute, /accountDeletionLocks/);
  assert.match(deleteRoute, /await db\.delete/);
  assert.doesNotMatch(deleteRoute, /PocketBase/);
  assert.doesNotMatch(deleteRoute, /usePocketBaseAdmin/);
});

test("legal Markdown links reject executable URL schemes", () => {
  assert.match(inlineTokens, /\["http:", "https:", "mailto:"\]/);
  assert.match(inlineTokens, /new URL\(href, "https:\/\/dspeak\.invalid"\)/);
});

test("auth.js uses Supabase Auth with local JWT verification", () => {
  assert.match(auth, /verifyAccessToken/);
  assert.doesNotMatch(auth, /PocketBase/);
  assert.doesNotMatch(auth, /ACCOUNT_URL/);
  assert.doesNotMatch(auth, /AUTH_HANDOFF_CONSENT_COOKIE/);
});
