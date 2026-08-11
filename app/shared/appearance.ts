import { DEFAULT_ROOM_ACCENT, ROOM_ACCENTS } from "~~/shared/room-policy.ts";

export const SURFACE_MODES = Object.freeze(["system", "light", "dark"]);

export function normalizeAppearance(value = {} as any) {
  value = value && typeof value === "object" ? value : {};
  return {
    surfaceMode: SURFACE_MODES.includes(value.surfaceMode)
      ? value.surfaceMode
      : "system",
    accent: ROOM_ACCENTS.includes(value.accent)
      ? value.accent
      : DEFAULT_ROOM_ACCENT,
  };
}

export function resolveSurfaceMode(mode, prefersDark = false) {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return prefersDark ? "dark" : "light";
}
