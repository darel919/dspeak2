import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.DSPEAK_CSRF_SECRET ||= "test-cleanup-secret";

const { createUploadCleanupToken, verifyUploadCleanupToken } =
  await import("../server/storage/upload-cleanup-token.js");

test("cleanup tokens bind an R2 key to its authenticated owner", () => {
  const token = createUploadCleanupToken(
    "user-1",
    "chat/channel/pending/file",
    100,
  );

  assert.deepEqual(verifyUploadCleanupToken(token, "user-1", 99), {
    key: "chat/channel/pending/file",
  });
  assert.equal(verifyUploadCleanupToken(token, "user-2", 99), null);
});

test("cleanup tokens reject tampering and expiry", () => {
  const token = createUploadCleanupToken("user-1", "avatars/user-1/file", 100);
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

  assert.equal(verifyUploadCleanupToken(tampered, "user-1", 99), null);
  assert.equal(verifyUploadCleanupToken(token, "user-1", 101), null);
});

test("prepared uploads expose authenticated cleanup and the client uses it on commit failure", () => {
  const prepare = readFileSync(
    new URL("../server/routes/api/files/prepare.post.js", import.meta.url),
    "utf8",
  );
  const cleanup = readFileSync(
    new URL("../server/routes/api/files/cleanup.post.js", import.meta.url),
    "utf8",
  );
  const client = readFileSync(
    new URL("../app/shared/image-upload.js", import.meta.url),
    "utf8",
  );

  assert.match(prepare, /cleanupToken/);
  assert.match(cleanup, /requireAuth\(event\)/);
  assert.match(cleanup, /verifyUploadCleanupToken/);
  assert.match(cleanup, /committedUploadExists/);
  assert.match(cleanup, /deleteObject\(key\)/);
  assert.match(client, /\/files\/cleanup/);
});

test("legacy multipart chat uploads write the bytes to R2 before creating metadata", () => {
  const source = readFileSync(
    new URL("../server/utils/dspeak-chat-api.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /putObject\(/);
  assert.match(source, /await putObject\(r2Key, file/);
});

test("profile avatar PATCH persists the R2 key and avatar metadata", () => {
  const source = readFileSync(
    new URL("../server/utils/dspeak-api.js", import.meta.url),
    "utf8",
  );
  const storage = readFileSync(
    new URL("../server/utils/profile-avatar-storage.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /updateProfileAvatar/);
  assert.match(storage, /putObject\(avatarKey, body\.avatar/);
  assert.match(storage, /update\.avatarKey/);
  assert.match(storage, /insert\(avatars\)/);
});
