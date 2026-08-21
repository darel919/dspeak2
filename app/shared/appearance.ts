import { DEFAULT_ROOM_ACCENT, ROOM_ACCENTS } from "~~/shared/room-policy.ts";
import type { AppearanceInput } from "./types/composables.ts";

export const SURFACE_MODES = Object.freeze(["system", "light", "dark"]);

export function normalizeAppearance(value: AppearanceInput = {}) {
  const surfaceMode = value.surfaceMode;
  const accent = value.accent;
  return {
    surfaceMode:
      surfaceMode && SURFACE_MODES.includes(surfaceMode)
        ? surfaceMode
        : "system",
    accent:
      accent && ROOM_ACCENTS.some((candidate) => candidate === accent)
        ? accent
        : DEFAULT_ROOM_ACCENT,
  };
}

export function resolveSurfaceMode(
  mode: AppearanceInput["surfaceMode"] | undefined,
  prefersDark = false,
): "light" | "dark" {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return prefersDark ? "dark" : "light";
}
