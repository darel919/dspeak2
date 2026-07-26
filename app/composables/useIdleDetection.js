import { usePresenceStatusStore } from "../stores/presenceStatus";
import { DEFAULT_IDLE_TIMEOUT_MS } from "~~/shared/presence-status.js";

export function useIdleDetection() {
  const presenceStore = usePresenceStatusStore();
  const idleTimeoutMs = ref(DEFAULT_IDLE_TIMEOUT_MS);
  const isIdle = computed(() => presenceStore.isIdle);

  let idleTimeout = null;
  let lastActivity = Date.now();

  function resetIdleTimer() {
    lastActivity = Date.now();
    if (idleTimeout) {
      clearTimeout(idleTimeout);
      idleTimeout = null;
    }
  }

  function startIdleTimer() {
    stopIdleTimer();
    const timeout = presenceStore.idleTimeout || DEFAULT_IDLE_TIMEOUT_MS;
    idleTimeout = setTimeout(() => {
      if (presenceStore.presenceOverride) return;
      presenceStore.setStatus("idle");
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
      presenceStore.setStatus("online");
    }
    resetIdleTimer();
    startIdleTimer();
  }

  function init() {
    if (!import.meta.client) return;

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

    for (const event of events) {
      window.addEventListener(event, handler, { passive: true });
    }

    startIdleTimer();

    onScopeDispose(() => {
      for (const event of events) {
        window.removeEventListener(event, handler);
      }
      stopIdleTimer();
    });
  }

  return {
    idleTimeoutMs,
    isIdle,
    init,
    onActivity,
    setIdleTimeout: (ms) => {
      presenceStore.setIdleTimeout(ms);
      idleTimeoutMs.value = ms;
      if (idleTimeout) {
        startIdleTimer();
      }
    },
  };
}
