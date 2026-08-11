import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createCloudflarePublicationRegistry } from "../app/shared/cloudflare-publication-registry.js";

test("Cloudflare publications survive transport reconstruction", () => {
  const registry = createCloudflarePublicationRegistry();
  const publication = {
    trackName: "track-1",
    peerId: "peer-1",
    source: "screen",
  };

  assert.equal(registry.update(publication), true);
  assert.deepEqual(registry.values(), [publication]);
  assert.deepEqual(registry.values(), [publication]);
});

test("Cloudflare publication replacement and closure remove stale tracks", () => {
  const registry = createCloudflarePublicationRegistry();
  registry.update({
    trackName: "track-old",
    peerId: "peer-1",
    source: "screen",
  });
  const replacement = {
    trackName: "track-new",
    peerId: "peer-1",
    source: "screen",
  };
  registry.update(replacement);

  assert.deepEqual(registry.values(), [replacement]);
  registry.update({
    trackName: "track-old",
    peerId: "peer-1",
    source: "screen",
    closed: true,
  });
  assert.deepEqual(registry.values(), [replacement]);
  registry.update({ ...replacement, closed: true });
  assert.deepEqual(registry.values(), []);
});

test("every Cloudflare activation path replays retained publications", async () => {
  const source = await readFile(
    new URL(
      "../app/shared/hybrid-media-topology-controller/controller.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /replayCloudflarePublications\(destinationSfu\)/);
  assert.match(source, /replayCloudflarePublications\(session\)/);
});
