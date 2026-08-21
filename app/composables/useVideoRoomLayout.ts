import { ref, type Ref } from "vue";

export type VideoRoomViewMode = "overview" | "focused";

export interface VideoRoomLayoutState {
  mode: VideoRoomViewMode;
  focusedTileKey: string | null;
}

export interface VideoRoomLayoutController {
  readonly mode: Readonly<Ref<VideoRoomViewMode>>;
  readonly focusedTileKey: Readonly<Ref<string | null>>;
  focusTile: (key: string) => void;
  showOverview: () => void;
  reconcileTiles: (keys: readonly string[]) => void;
}

export function useVideoRoomLayout(): VideoRoomLayoutController {
  const mode = ref<VideoRoomViewMode>("overview");
  const focusedTileKey = ref<string | null>(null);

  function focusTile(key: string): void {
    if (mode.value === "focused" && focusedTileKey.value === key) return;
    focusedTileKey.value = key;
    mode.value = "focused";
  }

  function showOverview(): void {
    mode.value = "overview";
    focusedTileKey.value = null;
  }

  function reconcileTiles(keys: readonly string[]): void {
    if (
      mode.value === "focused" &&
      focusedTileKey.value !== null &&
      !keys.includes(focusedTileKey.value)
    ) {
      showOverview();
    }
  }

  return {
    mode,
    focusedTileKey,
    focusTile,
    showOverview,
    reconcileTiles,
  };
}
