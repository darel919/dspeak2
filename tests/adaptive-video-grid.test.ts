import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateAdaptiveVideoGrid,
  type AdaptiveVideoGridLayout,
} from "../app/composables/useAdaptiveVideoGrid.ts";

function checkLayout(
  layout: AdaptiveVideoGridLayout,
  count: number,
  containerWidth: number,
  containerHeight: number,
) {
  assert.ok(Number.isFinite(layout.tileWidth), "tileWidth must be finite");
  assert.ok(Number.isFinite(layout.tileHeight), "tileHeight must be finite");
  assert.ok(layout.tileWidth >= 0, "tileWidth must be non-negative");
  assert.ok(layout.tileHeight >= 0, "tileHeight must be non-negative");
  assert.ok(layout.columns > 0, "columns must be positive");
  assert.ok(layout.rows > 0, "rows must be positive");
  assert.ok(
    layout.columns * layout.rows >= count,
    "must have enough cells for all tiles",
  );

  const totalWidth =
    layout.tileWidth * layout.columns +
    layout.gap * Math.max(0, layout.columns - 1);
  const totalHeight =
    layout.tileHeight * layout.rows + layout.gap * Math.max(0, layout.rows - 1);

  assert.ok(
    totalWidth <= containerWidth + 1,
    "total grid width must not exceed container width",
  );
  assert.ok(
    totalHeight <= containerHeight + 1,
    "total grid height must not exceed container height",
  );

  const aspectRatio = layout.tileWidth / layout.tileHeight;
  assert.ok(
    Math.abs(aspectRatio - 16 / 9) < 0.02,
    `tile aspect ratio should be ~16:9, got ${aspectRatio.toFixed(3)}`,
  );
}

describe("calculateAdaptiveVideoGrid", () => {
  it("handles count = 0", () => {
    const layout = calculateAdaptiveVideoGrid(0, 1280, 720);
    assert.equal(layout.columns, 0);
    assert.equal(layout.rows, 0);
    assert.equal(layout.tileWidth, 0);
    assert.equal(layout.tileHeight, 0);
  });

  it("handles count = 1", () => {
    const layout = calculateAdaptiveVideoGrid(1, 1280, 720);
    assert.equal(layout.columns, 1);
    assert.equal(layout.rows, 1);
    assert.ok(layout.tileWidth > 0);
    assert.ok(layout.tileHeight > 0);
    checkLayout(layout, 1, 1280, 720);
  });

  it("handles count = 2", () => {
    const layout = calculateAdaptiveVideoGrid(2, 1280, 720);
    checkLayout(layout, 2, 1280, 720);
  });

  it("handles count = 3", () => {
    const layout = calculateAdaptiveVideoGrid(3, 1280, 720);
    checkLayout(layout, 3, 1280, 720);
  });

  it("handles count = 4", () => {
    const layout = calculateAdaptiveVideoGrid(4, 1280, 720);
    checkLayout(layout, 4, 1280, 720);
  });

  it("handles count = 5", () => {
    const layout = calculateAdaptiveVideoGrid(5, 1280, 720);
    checkLayout(layout, 5, 1280, 720);
  });

  it("handles count = 6", () => {
    const layout = calculateAdaptiveVideoGrid(6, 1280, 720);
    checkLayout(layout, 6, 1280, 720);
  });

  it("handles count = 7", () => {
    const layout = calculateAdaptiveVideoGrid(7, 1280, 720);
    checkLayout(layout, 7, 1280, 720);
  });

  it("handles count = 8", () => {
    const layout = calculateAdaptiveVideoGrid(8, 1280, 720);
    checkLayout(layout, 8, 1280, 720);
  });

  it("handles count = 9", () => {
    const layout = calculateAdaptiveVideoGrid(9, 1280, 720);
    checkLayout(layout, 9, 1280, 720);
  });

  it("handles count = 12", () => {
    const layout = calculateAdaptiveVideoGrid(12, 1280, 720);
    checkLayout(layout, 12, 1280, 720);
  });

  it("handles count = 20", () => {
    const layout = calculateAdaptiveVideoGrid(20, 1280, 720);
    checkLayout(layout, 20, 1280, 720);
  });

  it("works with wide container (1200 x 400)", () => {
    const layout = calculateAdaptiveVideoGrid(6, 1200, 400);
    checkLayout(layout, 6, 1200, 400);
  });

  it("works with standard container (1280 x 720)", () => {
    const layout = calculateAdaptiveVideoGrid(6, 1280, 720);
    checkLayout(layout, 6, 1280, 720);
  });

  it("works with tall container (700 x 1000)", () => {
    const layout = calculateAdaptiveVideoGrid(6, 700, 1000);
    checkLayout(layout, 6, 700, 1000);
  });

  it("works with small container (480 x 320)", () => {
    const layout = calculateAdaptiveVideoGrid(4, 480, 320);
    checkLayout(layout, 4, 480, 320);
  });

  it("works with desktop container (1600 x 900)", () => {
    const layout = calculateAdaptiveVideoGrid(9, 1600, 900);
    checkLayout(layout, 9, 1600, 900);
  });

  it("returns deterministic layout for same inputs", () => {
    const layout1 = calculateAdaptiveVideoGrid(5, 1280, 720);
    const layout2 = calculateAdaptiveVideoGrid(5, 1280, 720);
    assert.deepEqual(layout1, layout2);
  });

  it("handles zero container dimensions", () => {
    const layout = calculateAdaptiveVideoGrid(5, 0, 0);
    assert.equal(layout.columns, 0);
    assert.equal(layout.rows, 0);
    assert.equal(layout.tileWidth, 0);
    assert.equal(layout.tileHeight, 0);
  });

  it("handles negative container dimensions", () => {
    const layout = calculateAdaptiveVideoGrid(5, -100, -100);
    assert.equal(layout.columns, 0);
    assert.equal(layout.rows, 0);
    assert.equal(layout.tileWidth, 0);
    assert.equal(layout.tileHeight, 0);
  });

  it("produces valid layout for 1 tile in various container shapes", () => {
    const shapes = [
      { w: 1200, h: 400 },
      { w: 1280, h: 720 },
      { w: 700, h: 1000 },
      { w: 480, h: 320 },
      { w: 1600, h: 900 },
    ];
    for (const { w, h } of shapes) {
      const layout = calculateAdaptiveVideoGrid(1, w, h);
      checkLayout(layout, 1, w, h);
    }
  });

  it("custom gap option is respected", () => {
    const layout = calculateAdaptiveVideoGrid(4, 1280, 720, { gap: 20 });
    assert.equal(layout.gap, 20);
    checkLayout(layout, 4, 1280, 720);
  });

  it("custom aspectRatio option is respected", () => {
    const layout = calculateAdaptiveVideoGrid(4, 1280, 720, {
      aspectRatio: 4 / 3,
    });
    const aspectRatio = layout.tileWidth / layout.tileHeight;
    assert.ok(Math.abs(aspectRatio - 4 / 3) < 0.02);
  });

  it("single tile does not exceed container bounds", () => {
    const layout = calculateAdaptiveVideoGrid(1, 400, 200);
    assert.ok(layout.tileWidth <= 400);
    assert.ok(layout.tileHeight <= 200);
  });
});
