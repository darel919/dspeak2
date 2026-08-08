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
});

test("account deletion preserves required message senders and uses Drizzle", () => {
  assert.match(deleteRoute, /content: "\[deleted\]"/);
  assert.doesNotMatch(deleteRoute, /sender:\s*null/);
  assert.match(deleteRoute, /deleteUser\(userId\)/);
  assert.match(deleteRoute, /accountDeletionLocks/);
  assert.match(deleteRoute, /withTransaction/);
  assert.match(deleteRoute, /async function deleteAccount\(tx, userId\)/);
  assert.ok(
    deleteRoute.indexOf("await withTransaction") <
      deleteRoute.indexOf("deleteUser(userId)"),
  );
  assert.doesNotMatch(deleteRoute, /delete\(users\)/);
  assert.doesNotMatch(deleteRoute, /await db\.(?:delete|update|select)/);
  assert.ok(
    deleteRoute.indexOf("const ownedRooms") <
      deleteRoute.indexOf("delete(roomMemberships)"),
  );
  assert.ok(
    deleteRoute.indexOf("delete(membershipRoles)") <
      deleteRoute.indexOf("delete(roomMemberships)"),
  );
});

test("legal Markdown links reject executable URL schemes", () => {
  assert.match(inlineTokens, /\["http:", "https:", "mailto:"\]/);
  assert.match(inlineTokens, /new URL\(href, "https:\/\/dspeak\.invalid"\)/);
});

test("auth.js uses Supabase Auth with local JWT verification", () => {
  assert.match(auth, /verifyAccessToken/);

  assert.doesNotMatch(auth, /ACCOUNT_URL/);
});
