import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";

import { uploadChatFile } from "../app/shared/image-upload.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("chat upload keeps signed storage requests credential-free and desktop-safe", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });

    if (url.endsWith("/files/prepare"))
      return Response.json({
        uploadUrl: "https://account.r2.cloudflarestorage.com/dspeak/chat/file",
        key: "chat/channel-1/file",
        cleanupToken: "cleanup-token",
      });
    if (url.startsWith("https://account.r2.cloudflarestorage.com"))
      return new Response(null, { status: 200 });
    if (url.endsWith("/files/commit"))
      return Response.json({
        record: {
          id: "file-1",
          fileName: "image.png",
          size: 3,
          mimeType: "image/png",
        },
      });
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await uploadChatFile(
    new File([new Uint8Array([1, 2, 3])], "image.png", {
      type: "image/png",
    }),
    "channel-1",
    "https://app.example/api",
  );

  const storageRequest = requests.find((request) =>
    request.url.startsWith("https://account.r2.cloudflarestorage.com"),
  );
  assert.equal(storageRequest?.init.credentials, "omit");
  assert.equal(
    result.url,
    "https://app.example/api/assets/chat-file?id=file-1",
  );
});

test("browser direct uploads are included in the production CSP connect policy", async () => {
  const config = await readFile(
    new URL("../nuxt.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(config, /CF_R2_ACCOUNT_ID/);
  assert.match(config, /r2\.cloudflarestorage\.com/);
});
