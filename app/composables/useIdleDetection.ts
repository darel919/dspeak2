import { usePresenceStatusStore } from "../stores/presenceStatus";
import { DEFAULT_IDLE_TIMEOUT_MS } from "~~/shared/presence-status.ts";

let isInitialized = false;

export function useIdleDetection() {
  const presenceStore = usePresenceStatusStore();
  const idleTimeoutMs = ref(DEFAULT_IDLE_TIMEOUT_MS);
  const isIdle = computed(() => presenceStore.isIdle);

  let idleTimeout: ReturnType<typeof setTimeout> | null = null;
  const events = [
    "mousedown",
    "keydown",
    "touchstart",
    "scroll",
    "mousemove",
    "wheel",
  ];
  let lastEvent = 0;

  const handler = () => {
    const now = Date.now();
    if (now - lastEvent < 2000) return;
    lastEvent = now;
    onActivity();
  };

  function resetIdleTimer() {
    if (idleTimeout) {
      clearTimeout(idleTimeout);
      idleTimeout = null;
    }
  }

  function startIdleTimer() {
    stopIdleTimer();
    const timeout = presenceStore.idleTimeout || DEFAULT_IDLE_TIMEOUT_MS;
    idleTimeout = setTimeout(() => {
      presenceStore.setAutomaticStatus("idle");
    }, timeout);
  }

  function stopIdleTimer() {
    if (idleTimeout) {
      clearTimeout(idleTimeout);
      idleTimeout = null;
    }
  }

  function onActivity() {
    if (
      presenceStore.effectiveStatus === "idle" &&
      !presenceStore.presenceOverride
    ) {
      presenceStore.setAutomaticStatus("online");
    }
    resetIdleTimer();
    startIdleTimer();
  }

  function init() {
    if (!import.meta.client) return;
    if (isInitialized) return;
    isInitialized = true;

    for (const event of events) {
      window.addEventListener(event, handler, { passive: true });
    }

    startIdleTimer();
  }

  function destroy() {
    if (import.meta.client && isInitialized) {
      for (const event of events) {
        window.removeEventListener(event, handler);
      }
    }
    stopIdleTimer();
    isInitialized = false;
  }

  return {
    idleTimeoutMs,
    isIdle,
    init,
    destroy,
    onActivity,
    setIdleTimeout: (ms: number) => {
      presenceStore.setIdleTimeout(ms);
      idleTimeoutMs.value = ms;
      if (idleTimeout) {
        startIdleTimer();
      }
    },
  };
}
