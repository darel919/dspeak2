import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  clampMediaPopupVolume,
  createMediaPopupFeed,
  mediaPopupFeedSignature,
  mediaPopupIdForFeed,
  normalizeMediaPopupFeed,
} from "../app/shared/media-popouts.ts";

describe("native media popout identity", () => {
  it("keeps the same popup identity when the native consumer is replaced", () => {
    const first = createMediaPopupFeed({
      userId: "user-1",
      source: "camera",
      logicalStreamId: "user:user-1/camera",
      native: true,
      consumerId: "consumer-a",
      label: "Ava",
    });
    const replacement = createMediaPopupFeed({
      userId: "user-1",
      source: "camera",
      logicalStreamId: "user:user-1/camera",
      native: true,
      consumerId: "consumer-b",
      label: "Ava",
    });

    assert.ok(first);
    assert.ok(replacement);
    assert.equal(first.popupId, replacement.popupId);
    assert.notEqual(first.eventId, replacement.eventId);
  });

  it("normalizes an offline popup without losing its participant identity", () => {
    const normalized = normalizeMediaPopupFeed({
      popupId: "media-popup:user:user-1/camera",
      participantId: "user-1",
      source: "camera",
      logicalStreamId: "user:user-1/camera",
      label: "Ava",
      online: false,
      eventId: null,
      volume: 3,
    });

    assert.deepEqual(normalized, {
      popupId: "media-popup:user:user-1/camera",
      participantId: "user-1",
      source: "camera",
      logicalStreamId: "user:user-1/camera",
      label: "Ava",
      avatar: "",
      native: false,
      eventId: null,
      online: false,
      receiving: true,
      volume: 2,
    });
  });

  it("bounds volume and changes the feed signature for signal transitions", () => {
    assert.equal(clampMediaPopupVolume(-1), 0);
    assert.equal(clampMediaPopupVolume(4), 2);
    assert.equal(clampMediaPopupVolume("invalid"), 1);
    const online = createMediaPopupFeed({
      userId: "user-1",
      source: "screen",
      native: true,
      eventId: "consumer-a",
      label: "Ava",
    });
    assert.ok(online);
    const offline = { ...online, online: false, eventId: null };
    assert.notEqual(
      mediaPopupFeedSignature(online),
      mediaPopupFeedSignature(offline),
    );
    assert.equal(mediaPopupIdForFeed(online), offline.popupId);
  });
});

describe("native media popout contracts", () => {
  it("uses managed child windows and the existing native receive event", async () => {
    const [rust, module, capability, popup, smpte, feed, voiceChannel] =
      await Promise.all([
        readFile("desktop/src-tauri/src/desktop/media_popups.rs", "utf8"),
        readFile("desktop/src-tauri/src/desktop/mod.rs", "utf8"),
        readFile("desktop/src-tauri/capabilities/media-popup.json", "utf8"),
        readFile("app/components/MediaPopupWindow.vue", "utf8"),
        readFile("app/components/MediaSmpteColorBars.vue", "utf8"),
        readFile("app/components/VideoFeed.vue", "utf8"),
        readFile("app/components/VoiceChannel.vue", "utf8"),
      ]);
    assert.match(rust, /WebviewWindowBuilder/);
    assert.match(rust, /desktop_open_media_popup/);
    assert.match(rust, /WindowEvent::Destroyed/);
    assert.match(module, /media_popups::desktop_close_media_popup/);
    assert.match(capability, /media-popup-\*/);
    assert.match(popup, /media:native-receive-event/);
    assert.match(popup, /desktop_close_media_popup/);
    assert.match(smpte, /No signal/);
    assert.match(feed, /is popped out/);
    assert.match(voiceChannel, /syncPopoutFeeds/);
  });
});
