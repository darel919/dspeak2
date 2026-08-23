import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  clampVolume,
  createMediaPopupFeed,
  mediaPopupFeedSignature,
  mediaPopupIdForFeed,
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

  it("bounds volume and changes the feed signature for signal transitions", () => {
    assert.equal(clampVolume(-1), 0);
    assert.equal(clampVolume(4), 2);
    assert.equal(clampVolume("invalid"), 1);
    const online = createMediaPopupFeed({
      userId: "user-1",
      source: "screen",
      native: true,
      eventId: "consumer-a",
      label: "Ava",
    });
    assert.ok(online);
    const offline: typeof online = {
      ...online,
      online: false,
      eventId: null,
    };
    assert.notEqual(
      mediaPopupFeedSignature(online),
      mediaPopupFeedSignature(offline),
    );
    assert.equal(mediaPopupIdForFeed(online), offline.popupId);
  });
});

describe("web media popout contracts", () => {
  it("uses document Picture-in-Picture for browser clients", async () => {
    const [pipModule, feed, voiceChannel] = await Promise.all([
      readFile("app/shared/video-picture-in-picture.ts", "utf8"),
      readFile("app/components/VideoFeed.vue", "utf8"),
      readFile("app/components/VoiceChannel.vue", "utf8"),
    ]);
    assert.match(pipModule, /requestPictureInPicture/);
    assert.match(feed, /canWebPopOut/);
    assert.match(feed, /handleWebPopOut/);
    assert.match(voiceChannel, /useWebMediaPopouts/);
    assert.match(
      voiceChannel,
      /supportsWebPopOut && !tile\.feed\.local && !!tile\.feed\.stream/,
    );
  });

  it("keeps desktop popouts on native windows and web popouts on PiP paths", async () => {
    const [voiceChannel, popouts] = await Promise.all([
      readFile("app/components/VoiceChannel.vue", "utf8"),
      readFile("app/shared/media-popouts.ts", "utf8"),
    ]);
    assert.match(voiceChannel, /runtimeStore\.isTauri/);
    assert.match(voiceChannel, /@pop-out="openMediaPopout/);
    assert.match(popouts, /desktop_open_media_popup|MEDIA_POPUP_EVENTS/);
  });
});

describe("native media popout contracts", () => {
  it("renders popups in webview-less native windows fed by worker frame events", async () => {
    const [rust, renderer, module, capability, feed, voiceChannel] =
      await Promise.all([
        readFile("desktop/src-tauri/src/desktop/media_popups.rs", "utf8"),
        readFile("desktop/src-tauri/src/desktop/popup_renderer.rs", "utf8"),
        readFile("desktop/src-tauri/src/desktop/mod.rs", "utf8"),
        readFile("desktop/src-tauri/capabilities/media-popup.json", "utf8"),
        readFile("app/components/VideoFeed.vue", "utf8"),
        readFile("app/components/VoiceChannel.vue", "utf8"),
      ]);
    assert.match(rust, /WindowBuilder::new/);
    assert.match(rust, /desktop_open_media_popup/);
    assert.match(rust, /WindowEvent::Destroyed/);
    assert.doesNotMatch(rust, /WebviewWindowBuilder|mediaPopupId=/);
    assert.match(renderer, /softbuffer::Context/);
    assert.match(renderer, /letterbox_region/);
    assert.match(module, /media_popups::mark_all_offline/);
    assert.match(rust, /desktop_set_media_popup_offline/);
    assert.match(capability, /media-popup-\*/);
    assert.doesNotMatch(module, /mediaPopupId=|MediaPopupWindow/);
    assert.match(feed, /is popped out/);
    assert.match(voiceChannel, /syncPopoutFeeds/);
  });
});
