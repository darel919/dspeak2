import { onBeforeUnmount, onMounted, ref } from "vue";
import { isWebPopOutActive } from "~/shared/video-picture-in-picture.ts";

function createWebMediaPopouts() {
  const active = ref(false);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function refresh() {
    active.value = isWebPopOutActive();
  }

  function startTracking() {
    if (pollTimer || !import.meta.client) return;
    document.addEventListener("enterpictureinpicture", refresh, true);
    document.addEventListener("leavepictureinpicture", refresh, true);
    pollTimer = setInterval(refresh, 2000);
    refresh();
  }

  function stopTracking() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
    document.removeEventListener("enterpictureinpicture", refresh, true);
    document.removeEventListener("leavepictureinpicture", refresh, true);
  }

  onMounted(startTracking);
  onBeforeUnmount(stopTracking);

  return { active };
}

let singleton: ReturnType<typeof createWebMediaPopouts> | null = null;

export function useWebMediaPopouts() {
  if (!singleton) singleton = createWebMediaPopouts();
  return singleton;
}
