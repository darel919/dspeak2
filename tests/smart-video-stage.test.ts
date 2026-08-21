import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getSmartVideoStageLayout,
  type SmartVideoTile,
} from "../app/shared/smart-video-stage.ts";

const feed = (key: string, source: string): SmartVideoTile => ({
  key,
  type: "feed",
  source,
});

describe("getSmartVideoStageLayout", () => {
  it("spotlights screen sharing ahead of camera feeds", () => {
    const layout = getSmartVideoStageLayout([
      feed("camera", "camera"),
      feed("screen", "screen"),
      { key: "listener", type: "participant" },
    ]);

    assert.deepEqual(layout, {
      mode: "spotlight",
      heroKey: "screen",
    });
  });

  it("spotlights the only camera feed while keeping audio participants as support", () => {
    const layout = getSmartVideoStageLayout([
      feed("camera", "camera"),
      { key: "listener", type: "participant" },
    ]);

    assert.deepEqual(layout, {
      mode: "spotlight",
      heroKey: "camera",
    });
  });

  it("keeps multiple camera feeds in the equal grid", () => {
    const layout = getSmartVideoStageLayout([
      feed("camera-a", "camera"),
      feed("camera-b", "camera"),
    ]);

    assert.deepEqual(layout, {
      mode: "grid",
      heroKey: null,
    });
  });

  it("keeps a screen share in spotlight mode with many support tiles", () => {
    const layout = getSmartVideoStageLayout([
      feed("screen", "screen"),
      ...Array.from({ length: 8 }, (_, index) => ({
        key: `participant-${index}`,
        type: "participant" as const,
      })),
    ]);

    assert.equal(layout.mode, "spotlight");
    assert.equal(layout.heroKey, "screen");
  });

  it("does not spotlight an audio-only room", () => {
    const layout = getSmartVideoStageLayout([
      { key: "speaker-a", type: "participant" },
      { key: "speaker-b", type: "participant" },
    ]);

    assert.deepEqual(layout, {
      mode: "grid",
      heroKey: null,
    });
  });
});
