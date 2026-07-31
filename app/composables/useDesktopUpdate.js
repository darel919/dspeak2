import { useRuntimeStore } from "~/stores/runtime";

const DESKTOP_UPDATE_STATE = "desktop-update-state";

async function getTauriInvoke() {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

export function useDesktopUpdate() {
  const runtimeStore = useRuntimeStore();
  const state = useState(DESKTOP_UPDATE_STATE, () => ({
    status: "idle",
    update: null,
    error: null,
    deferred: false,
  }));
  const checking = computed(() => state.value.status === "checking");
  const installing = computed(() => state.value.status === "installing");
  const updateAvailable = computed(() => Boolean(state.value.update));
  const completed = computed(() => state.value.status === "complete");

  async function runStartupUpdate() {
    if (!runtimeStore.isTauri) {
      state.value.status = "complete";
      return null;
    }

    state.value = {
      ...state.value,
      status: "checking",
      error: null,
    };

    try {
      const invoke = await getTauriInvoke();
      const update = await invoke("check_for_updates");
      state.value = {
        ...state.value,
        status: "complete",
        update: update || null,
        deferred: false,
      };
      return update || null;
    } catch (error) {
      state.value = {
        ...state.value,
        status: "error",
        error,
      };
      return null;
    }
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
    installUpdate,
    deferUpdate,
  };
}
