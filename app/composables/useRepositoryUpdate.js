const STATE_KEY = "repository-update-state";
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;
let sharedRequest = null;

function normalizeCommit(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(normalized) ? normalized : null;
}

export function useRepositoryUpdate() {
  const config = useRuntimeConfig();
  const state = useState(STATE_KEY, () => ({
    status: "idle",
    snapshot: null,
    error: null,
  }));
  const checking = computed(() => state.value.status === "checking");
  const snapshot = computed(() => state.value.snapshot);
  const currentBuild = computed(() => config.public?.appBuild || {});
  const deployedUpdateAvailable = computed(() =>
    Boolean(snapshot.value?.deployedUpdateAvailable),
  );
  const sourceUpdateAvailable = computed(() =>
    Boolean(snapshot.value?.sourceUpdateAvailable),
  );
  const updateAvailable = computed(
    () => deployedUpdateAvailable.value || sourceUpdateAvailable.value,
  );
  async function checkForUpdate() {
    if (!import.meta.client || import.meta.dev) {
      state.value.status = "complete";
      return null;
    }
    if (sharedRequest) return sharedRequest;

    state.value = {
      ...state.value,
      status: "checking",
      error: null,
    };
    sharedRequest = (async () => {
      const apiPath = String(config.public?.apiPath || "/api").replace(
        /\/$/,
        "",
      );
      const commit = normalizeCommit(currentBuild.value.commit);
      const query = commit ? `?commit=${encodeURIComponent(commit)}` : "";
      const response = await fetch(`${apiPath}/update${query}`, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok)
        throw new Error(`Update check failed (${response.status})`);
      const nextSnapshot = await response.json();
      state.value = {
        ...state.value,
        status: nextSnapshot?.status === "ok" ? "complete" : "unavailable",
        snapshot: nextSnapshot,
      };
      return nextSnapshot;
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
        sharedRequest = null;
      });
    return sharedRequest;
  }

  function startMonitoring() {
    if (!import.meta.client || import.meta.dev) return () => {};

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

  return {
    status: computed(() => state.value.status),
    checking,
    snapshot,
    currentBuild,
    deployedUpdateAvailable,
    sourceUpdateAvailable,
    updateAvailable,
    error: computed(() => state.value.error),
    checkForUpdate,
    startMonitoring,
  };
}
