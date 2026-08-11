import { useRuntimeStore } from "~/stores/runtime";
import type {
  DesktopUpdate,
  DesktopUpdateState,
} from "../shared/types/desktop-update.ts";

const DESKTOP_UPDATE_STATE = "desktop-update-state";
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

async function getTauriInvoke() {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

function isDesktopDevelopment() {
  if (import.meta.dev) return true;
  if (!import.meta.client) return false;
  return (
    ["http:", "https:"].includes(window.location.protocol) &&
    ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
  );
}

export function useDesktopUpdate() {
  const runtimeStore = useRuntimeStore();
  const state = useState<DesktopUpdateState>(DESKTOP_UPDATE_STATE, () => ({
    status: "idle",
    update: null,
    error: null,
    deferred: false,
  }));
  const checking = computed(() => state.value.status === "checking");
  const installing = computed(() => state.value.status === "installing");
  const updateAvailable = computed(() => Boolean(state.value.update));
  const completed = computed(() => state.value.status === "complete");
  let request: Promise<DesktopUpdate | null> | null = null;

  async function checkForUpdate() {
    if (!runtimeStore.isTauri || isDesktopDevelopment()) {
      state.value.status = "complete";
      return null;
    }
    if (request) return request;
    if (state.value.status === "installing") return state.value.update;

    state.value = {
      ...state.value,
      status: "checking",
      error: null,
    };

    request = (async () => {
      const invoke = await getTauriInvoke();
      const update = (await invoke(
        "check_for_updates",
      )) as DesktopUpdate | null;
      const previousVersion = state.value.update?.version;
      state.value = {
        ...state.value,
        status: "complete",
        update: update || null,
        deferred:
          update && previousVersion !== update.version
            ? false
            : state.value.deferred,
      };
      return update || null;
    })()
      .catch((error) => {
        state.value = {
          ...state.value,
          status: "error",
          error,
        };
        return null;
      })
      .finally(() => {
        request = null;
      });
    return request;
  }

  async function runStartupUpdate() {
    if (!runtimeStore.isTauri || isDesktopDevelopment()) {
      state.value.status = "complete";
      return null;
    }
    return checkForUpdate();
  }

  function startMonitoring() {
    if (!runtimeStore.isTauri || isDesktopDevelopment()) return () => {};

    const checkWhenAvailable = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      void checkForUpdate();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") checkWhenAvailable();
    };
    const handleOnline = () => checkWhenAvailable();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    const interval = window.setInterval(checkWhenAvailable, UPDATE_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.clearInterval(interval);
    };
  }

  async function installUpdate() {
    if (!state.value.update || installing.value) return false;

    state.value = {
      ...state.value,
      status: "installing",
      error: null,
    };

    try {
      const invoke = await getTauriInvoke();
      await invoke("install_update");
      state.value = {
        ...state.value,
        status: "installed",
      };
      return true;
    } catch (error) {
      state.value = {
        ...state.value,
        status: "error",
        error,
      };
      return false;
    }
  }

  function deferUpdate() {
    state.value = {
      ...state.value,
      deferred: true,
    };
  }

  return {
    status: computed(() => state.value.status),
    update: computed(() => state.value.update),
    error: computed(() => state.value.error),
    checking,
    installing,
    updateAvailable,
    deferred: computed(() => state.value.deferred),
    completed,
    runStartupUpdate,
    startMonitoring,
    installUpdate,
    deferUpdate,
  };
}
