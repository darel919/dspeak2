import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { useVideoRoomLayout } from "../app/composables/useVideoRoomLayout.ts";

function snapshot(layout: ReturnType<typeof useVideoRoomLayout>) {
  return {
    mode: layout.mode.value,
    focusedTileKey: layout.focusedTileKey.value,
  };
}

describe("useVideoRoomLayout", () => {
  it("starts in overview without a focused tile", () => {
    const layout = useVideoRoomLayout();

    assert.deepEqual(snapshot(layout), {
      mode: "overview",
      focusedTileKey: null,
    });
  });

  it("focuses a tile immediately", () => {
    const layout = useVideoRoomLayout();

    layout.focusTile("camera");

    assert.deepEqual(snapshot(layout), {
      mode: "focused",
      focusedTileKey: "camera",
    });
  });

  it("keeps a repeated focus selection idempotent", () => {
    const layout = useVideoRoomLayout();

    layout.focusTile("camera");
    layout.focusTile("camera");

    assert.deepEqual(snapshot(layout), {
      mode: "focused",
      focusedTileKey: "camera",
    });
  });

  it("switches focus to another visible tile", () => {
    const layout = useVideoRoomLayout();

    layout.focusTile("camera");
    layout.focusTile("screen");

    assert.deepEqual(snapshot(layout), {
      mode: "focused",
      focusedTileKey: "screen",
    });
  });

  it("returns to overview and clears focus", () => {
    const layout = useVideoRoomLayout();

    layout.focusTile("camera");
    layout.showOverview();

    assert.deepEqual(snapshot(layout), {
      mode: "overview",
      focusedTileKey: null,
    });
  });

  it("returns to overview when the focused tile disappears", () => {
    const layout = useVideoRoomLayout();

    layout.focusTile("screen");
    layout.reconcileTiles(["camera", "participant"]);

    assert.deepEqual(snapshot(layout), {
      mode: "overview",
      focusedTileKey: null,
    });
  });

  it("does not change focus when a screen-share tile appears", () => {
    const layout = useVideoRoomLayout();

    layout.focusTile("camera");
    layout.reconcileTiles(["screen", "camera"]);

    assert.deepEqual(snapshot(layout), {
      mode: "focused",
      focusedTileKey: "camera",
    });
  });

  it("does not change focus when a broadcast tile appears", () => {
    const layout = useVideoRoomLayout();

    layout.focusTile("camera");
    layout.reconcileTiles(["broadcast", "camera"]);

    assert.deepEqual(snapshot(layout), {
      mode: "focused",
      focusedTileKey: "camera",
    });
  });
});
