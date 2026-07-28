import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  authentication,
  api,
  migrations,
  exportRoute,
  deleteRoute,
  inlineTokens,
] = await Promise.all(
  [
    "../server/utils/authentication.js",
    "../server/utils/dspeak-api.js",
    "../server/utils/pocketbase-migrations.js",
    "../server/routes/api/account/export.get.js",
    "../server/routes/api/account/delete.post.js",
    "../app/components/InlineTokens.vue",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);

test("external sign-in binds legal consent to the server-side handoff", () => {
  assert.match(api, /body\.terms_accepted !== true/);
  assert.match(authentication, /AUTH_HANDOFF_CONSENT_COOKIE/);
  assert.match(authentication, /consentAccepted/);
  assert.doesNotMatch(api, /Boolean\(body\.terms_accepted\)/);
});

test("legal consent has a repairable PocketBase schema migration", () => {
  assert.match(migrations, /terms_accepted_at/);
  assert.match(migrations, /20260728_legal_consent_v1/);
});

test("account export reads complete records with the managed field names", () => {
  assert.match(exportRoute, /getFullList/);
  assert.match(exportRoute, /account-export/);
  assert.match(exportRoute, /Cache-Control.*private, no-store/);
  assert.match(exportRoute, /subject = \{:\w+\}/);
  assert.match(exportRoute, /read_by \?= \{:\w+\}/);
  assert.match(exportRoute, /readReceipts/);
  assert.match(exportRoute, /fields:\s*\n\s*"id,name,desc,picture/);
  assert.match(
    exportRoute,
    /fields:\s*\n\s*"id,uploader,room_channel,message,file/,
  );
  assert.match(exportRoute, /fields:\s*\n\s*"id,user,connected,muted,deafened/);
  assert.doesNotMatch(exportRoute, /getList\(1,\s*(100|1000)/);
});

test("account deletion preserves required message senders and delays session removal", () => {
  assert.match(deleteRoute, /content: "\[deleted\]"/);
  assert.doesNotMatch(deleteRoute, /sender:\s*null/);
  assert.match(deleteRoute, /disconnectVoiceParticipant/);
  assert.match(deleteRoute, /accountDeletionLocks/);
  assert.match(deleteRoute, /read_by \?= \{:\w+\}/);
  assert.match(
    deleteRoute,
    /await deleteUserRecords\(pb, "dspeak_sessions", "user", userId\);/,
  );
  assert.ok(
    deleteRoute.indexOf('await deleteUserRecords(pb, "dspeak_sessions"') >
      deleteRoute.indexOf('await pb.collection("users").update'),
  );
});

test("legal Markdown links reject executable URL schemes", () => {
  assert.match(inlineTokens, /\["http:", "https:", "mailto:"\]/);
  assert.match(inlineTokens, /new URL\(href, "https:\/\/dspeak\.invalid"\)/);
});
