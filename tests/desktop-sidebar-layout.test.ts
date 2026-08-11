import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampDesktopSidebarWidth,
  DESKTOP_SIDEBAR_DEFAULT_WIDTH,
  DESKTOP_SIDEBAR_MAX_WIDTH,
  DESKTOP_SIDEBAR_MIN_WIDTH,
} from "../app/shared/desktop-sidebar-layout.ts";

describe("desktop channel sidebar layout", () => {
  it("keeps widths inside the supported desktop range", () => {
    assert.equal(
      clampDesktopSidebarWidth(DESKTOP_SIDEBAR_MIN_WIDTH - 100),
      DESKTOP_SIDEBAR_MIN_WIDTH,
    );
    assert.equal(
      clampDesktopSidebarWidth(DESKTOP_SIDEBAR_MAX_WIDTH + 100),
      DESKTOP_SIDEBAR_MAX_WIDTH,
    );
    assert.equal(clampDesktopSidebarWidth(336.4), 336);
  });

  it("uses the default width for invalid persisted values", () => {
    assert.equal(
      clampDesktopSidebarWidth("invalid"),
      DESKTOP_SIDEBAR_DEFAULT_WIDTH,
    );
    assert.equal(
      clampDesktopSidebarWidth(undefined),
      DESKTOP_SIDEBAR_DEFAULT_WIDTH,
    );
  });
});
