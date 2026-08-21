import { registerServiceWorker } from "../shared/service-worker-registration.ts";
import {
  hasTauriRuntimeMarker,
  isDesktopClient,
} from "../shared/desktop-capture.ts";
import type {
  PwaUpdateRuntime,
  PwaUpdateState,
} from "../shared/types/pwa-update.ts";
import {
  isExternalRecord,
  isExternalString,
} from "../shared/types/boundary.ts";
import type { ExternalField } from "~~/shared/types/external.ts";

const STARTUP_RESTART_GUARD = "dspeak-pwa-startup-restart";
const INSTALL_WAIT_MS = 10000;
const ACTIVATION_WAIT_MS = 5000;
const VERSION_WAIT_MS = 1000;
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

let runtime: PwaUpdateRuntime | null = null;

function waitForState(
  worker: ServiceWorker | null,
  expectedStates: ServiceWorkerState[],
  timeout: number,
): Promise<ServiceWorkerState | undefined> {
  if (!worker || expectedStates.includes(worker.state))
    return Promise.resolve(worker?.state);

  return new Promise((resolve) => {
    let timer: number | null = null;
    const finish = () => {
      worker.removeEventListener("statechange", handleStateChange);
      if (timer) window.clearTimeout(timer);
      resolve(worker.state);
    };
    const handleStateChange = () => {
      if (expectedStates.includes(worker.state)) finish();
    };

    worker.addEventListener("statechange", handleStateChange);
    timer = window.setTimeout(finish, timeout);
  });
}

function createRuntime(state: PwaUpdateState): PwaUpdateRuntime {
  return {
    ...state,
    registration: null,
    registrationPromise: null,
    installingWorker: null,
    startupWorker: null,
    activationWorker: null,
    updateInterval: null,
    reloadStarted: false,
    listenersAttached: false,
    startupRestartAttempted: null,
  };
}

function workerVersion(worker: ServiceWorker | null): Promise<string | null> {
  if (!worker) return Promise.resolve(null);

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let timer: number | null = null;
    const finish = (version: ExternalField) => {
      if (timer) window.clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(isExternalString(version) && version ? version : null);
    };

    channel.port1.onmessage = (event) => {
      finish(event.data?.type === "VERSION" ? event.data.version : null);
    };
    timer = window.setTimeout(() => finish(null), VERSION_WAIT_MS);
    worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
  });
}

export function usePwaUpdate() {
  const updateAvailable = useState("pwa-update-available", () => false);
  const refreshing = useState("pwa-update-refreshing", () => false);
  const reloadRequired = useState("pwa-reload-required", () => false);
  const startupFinished = useState("pwa-startup-finished", () => false);
  const startupUpdateStatus = useState(
    "pwa-startup-update-status",
    () => "idle",
  );

  function currentRuntime(): PwaUpdateRuntime {
    if (!runtime) {
      runtime = createRuntime({
        updateAvailable,
        refreshing,
        reloadRequired,
        startupFinished,
        startupUpdateStatus,
      });
    }
    return runtime;
  }

  function syncUpdateAvailable(activeRuntime: PwaUpdateRuntime) {
    const waitingWorker = Boolean(
      navigator.serviceWorker.controller &&
      activeRuntime.registration?.waiting?.state === "installed",
    );
    const activeSessionWaiting =
      waitingWorker &&
      activeRuntime.startupFinished.value &&
      activeRuntime.registration !== null &&
      activeRuntime.registration.waiting !== activeRuntime.startupWorker;
    activeRuntime.updateAvailable.value =
      activeRuntime.reloadRequired.value || Boolean(activeSessionWaiting);
  }

  function observeInstallingWorker(
    activeRuntime: PwaUpdateRuntime,
    worker: ServiceWorker | null | undefined,
  ) {
    if (!worker || worker === activeRuntime.installingWorker) return;
    activeRuntime.installingWorker = worker;
    if (!activeRuntime.startupFinished.value)
      activeRuntime.startupWorker = worker;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" || worker.state === "redundant") {
        syncUpdateAvailable(activeRuntime);
      }
    });
  }

  function inspectRegistration(activeRuntime: PwaUpdateRuntime) {
    observeInstallingWorker(
      activeRuntime,
      activeRuntime.registration?.installing,
    );
    syncUpdateAvailable(activeRuntime);
  }

  function reloadApplication(activeRuntime: PwaUpdateRuntime) {
    if (activeRuntime.reloadStarted) return;
    activeRuntime.reloadStarted = true;
    window.location.reload();
  }

  function startupRestartGuard(activeRuntime: PwaUpdateRuntime) {
    if (activeRuntime.startupRestartAttempted)
      return activeRuntime.startupRestartAttempted;
    try {
      const storedGuard = sessionStorage.getItem(STARTUP_RESTART_GUARD);
      if (!storedGuard || storedGuard === "attempted") return null;
      const parsedGuard = JSON.parse(storedGuard);
      return isExternalRecord(parsedGuard) &&
        isExternalString(parsedGuard.version)
        ? parsedGuard.version
        : null;
    } catch (error) {
      console.warn("[ServiceWorker] Startup restart guard unavailable:", error);
      return null;
    }
  }

  function setStartupRestartGuard(
    activeRuntime: PwaUpdateRuntime,
    version: string,
  ) {
    activeRuntime.startupRestartAttempted = version;
    try {
      sessionStorage.setItem(
        STARTUP_RESTART_GUARD,
        JSON.stringify({ version }),
      );
    } catch (error) {
      console.warn("[ServiceWorker] Startup restart guard unavailable:", error);
    }
  }

  function clearStartupRestartGuard(activeRuntime: PwaUpdateRuntime) {
    activeRuntime.startupRestartAttempted = null;
    try {
      sessionStorage.removeItem(STARTUP_RESTART_GUARD);
    } catch (error) {
      console.warn("[ServiceWorker] Startup restart guard unavailable:", error);
    }
  }

  function handleControllerChange(activeRuntime: PwaUpdateRuntime) {
    if (activeRuntime.activationWorker) {
      reloadApplication(activeRuntime);
      return;
    }
    if (
      activeRuntime.startupWorker &&
      activeRuntime.registration?.active === activeRuntime.startupWorker
    ) {
      reloadApplication(activeRuntime);
      return;
    }
    if (!activeRuntime.startupFinished.value) {
      reloadApplication(activeRuntime);
      return;
    }
    activeRuntime.reloadRequired.value = true;
    activeRuntime.updateAvailable.value = true;
  }

  function attachListeners(activeRuntime: PwaUpdateRuntime) {
    if (activeRuntime.listenersAttached) return;
    const registration = activeRuntime.registration;
    if (!registration) return;
    activeRuntime.listenersAttached = true;
    registration.addEventListener("updatefound", () => {
      observeInstallingWorker(activeRuntime, registration.installing);
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      handleControllerChange(activeRuntime);
    });
  }

  async function ensureRegistration(
    activeRuntime: PwaUpdateRuntime,
  ): Promise<ServiceWorkerRegistration> {
    if (activeRuntime.registration) return activeRuntime.registration;
    if (!activeRuntime.registrationPromise) {
      activeRuntime.registrationPromise = registerServiceWorker()
        .then((registration) => {
          if (!registration)
            throw new Error("Service worker registration unavailable");
          activeRuntime.registration = registration;
          attachListeners(activeRuntime);
          inspectRegistration(activeRuntime);
          return registration;
        })
        .catch((error) => {
          activeRuntime.registrationPromise = null;
          throw error;
        });
    }
    const registration = await activeRuntime.registrationPromise;
    if (!registration)
      throw new Error("Service worker registration unavailable");
    return registration;
  }

  async function checkForUpdate() {
    if (
      import.meta.dev ||
      !import.meta.client ||
      !("serviceWorker" in navigator) ||
      !navigator.onLine
    )
      return;

    const activeRuntime = currentRuntime();
    try {
      const registration = await ensureRegistration(activeRuntime);
      await registration.update();
      const installingWorker = registration.installing;
      observeInstallingWorker(activeRuntime, installingWorker);
      if (installingWorker) {
        await waitForState(
          installingWorker,
          ["installed", "activated", "redundant"],
          INSTALL_WAIT_MS,
        );
      }
      inspectRegistration(activeRuntime);
    } catch (error) {
      console.warn("[ServiceWorker] Update check failed:", error);
    }
  }

  async function activateWaitingWorker(mode: "active" | "startup") {
    const activeRuntime = currentRuntime();
    const worker = activeRuntime.registration?.waiting;
    if (!worker || worker.state !== "installed") {
      inspectRegistration(activeRuntime);
      return false;
    }

    activeRuntime.activationWorker = worker;
    activeRuntime.refreshing.value = mode === "active";
    worker.postMessage({ type: "SKIP_WAITING" });
    const workerState = await waitForState(
      worker,
      ["activated", "redundant"],
      ACTIVATION_WAIT_MS,
    );
    if (
      workerState === "activated" ||
      activeRuntime.registration?.active === worker
    ) {
      reloadApplication(activeRuntime);
      return true;
    }

    activeRuntime.activationWorker = null;
    activeRuntime.refreshing.value = false;
    inspectRegistration(activeRuntime);
    return false;
  }

  async function runStartupUpdate() {
    if (await isDesktopClient()) {
      startupFinished.value = true;
      return;
    }
    if (
      import.meta.dev ||
      !import.meta.client ||
      !("serviceWorker" in navigator)
    ) {
      startupFinished.value = true;
      return;
    }

    const activeRuntime = currentRuntime();
    startupUpdateStatus.value = "checking";
    try {
      await ensureRegistration(activeRuntime);
      await checkForUpdate();

      if (!activeRuntime.registration?.waiting) {
        clearStartupRestartGuard(activeRuntime);
        return;
      }

      startupUpdateStatus.value = "updating";
      activeRuntime.startupWorker = activeRuntime.registration.waiting;
      const version = await workerVersion(activeRuntime.startupWorker);
      const updateIdentity = version || "unknown";
      const guardedVersion = startupRestartGuard(activeRuntime);
      if (guardedVersion !== updateIdentity)
        setStartupRestartGuard(activeRuntime, updateIdentity);
      await activateWaitingWorker("startup");
    } catch (error) {
      console.warn("[ServiceWorker] Startup update failed:", error);
    } finally {
      if (!activeRuntime.reloadRequired.value)
        activeRuntime.updateAvailable.value = false;
      startupUpdateStatus.value = "complete";
      startupFinished.value = true;
    }
  }

  function startActiveMonitoring() {
    if (
      import.meta.dev ||
      !import.meta.client ||
      hasTauriRuntimeMarker() ||
      !("serviceWorker" in navigator)
    )
      return () => {};

    const activeRuntime = currentRuntime();
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        activeRuntime.startupFinished.value
      )
        checkForUpdate();
    };
    const handleOnline = () => {
      if (activeRuntime.startupFinished.value) checkForUpdate();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    activeRuntime.updateInterval = window.setInterval(() => {
      if (activeRuntime.startupFinished.value) checkForUpdate();
    }, UPDATE_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      if (activeRuntime.updateInterval) {
        window.clearInterval(activeRuntime.updateInterval);
        activeRuntime.updateInterval = null;
      }
    };
  }

  async function activateUpdate() {
    if (refreshing.value) return;
    const activeRuntime = currentRuntime();
    if (reloadRequired.value) {
      reloadApplication(activeRuntime);
      return;
    }

    try {
      await ensureRegistration(activeRuntime);
      inspectRegistration(activeRuntime);
      clearStartupRestartGuard(activeRuntime);
      if (!(await activateWaitingWorker("active"))) {
        updateAvailable.value = false;
        await checkForUpdate();
      }
    } catch (error) {
      refreshing.value = false;
      console.warn("[ServiceWorker] Update activation failed:", error);
    }
  }

  return {
    updateAvailable,
    refreshing,
    startupFinished,
    startupUpdateStatus,
    runStartupUpdate,
    checkForUpdate,
    startActiveMonitoring,
    activateUpdate,
  };
}
