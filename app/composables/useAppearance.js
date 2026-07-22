import { useRoomsStore } from "../stores/rooms";
import { useSettingsStore } from "../stores/settings";
import { resolveSurfaceMode } from "../shared/appearance";

export function useAppearance() {
  const route = useRoute();
  const roomsStore = useRoomsStore();
  const settingsStore = useSettingsStore();
  const systemDark = ref(false);
  let mediaQuery = null;

  const currentRoom = computed(() =>
    roomsStore.getRoomById(String(route.params.roomId || "")),
  );
  const activeAccent = computed(
    () => currentRoom.value?.accent || settingsStore.appearance.accent,
  );
  const activeSurface = computed(() =>
    resolveSurfaceMode(settingsStore.appearance.surfaceMode, systemDark.value),
  );

  function apply() {
    if (!import.meta.client) return;
    document.documentElement.dataset.theme = activeSurface.value;
    document.documentElement.dataset.accent = activeAccent.value;
  }

  function onSystemTheme(event) {
    systemDark.value = event.matches;
  }

  watch([activeAccent, activeSurface], apply, { immediate: true });
  onMounted(() => {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    systemDark.value = mediaQuery.matches;
    mediaQuery.addEventListener("change", onSystemTheme);
    apply();
  });
  onUnmounted(() => mediaQuery?.removeEventListener("change", onSystemTheme));

  return { activeAccent, activeSurface };
}
