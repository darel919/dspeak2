export const DESKTOP_SIDEBAR_DEFAULT_WIDTH = 280;
export const DESKTOP_SIDEBAR_MIN_WIDTH = 240;
export const DESKTOP_SIDEBAR_MAX_WIDTH = 480;
export const DESKTOP_SIDEBAR_KEYBOARD_STEP = 16;

export function clampDesktopSidebarWidth(width: number) {
  const numericWidth = Number(width);
  if (!Number.isFinite(numericWidth)) return DESKTOP_SIDEBAR_DEFAULT_WIDTH;
  return Math.min(
    DESKTOP_SIDEBAR_MAX_WIDTH,
    Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, Math.round(numericWidth)),
  );
}
