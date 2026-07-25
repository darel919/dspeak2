import { registerServiceWorker } from "../shared/service-worker-registration.js";

const STARTUP_RESTART_GUARD = "dspeak-pwa-startup-restart";
const INSTALL_WAIT_MS = 10000;
const ACTIVATION_WAIT_MS = 5000;
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

let runtime = null;

function waitForState(worker, expectedStates, timeout) {
  if (!worker || expectedStates.includes(worker.state))
    return Promise.resolve(worker?.state);

  return new Promise((resolve) => {
    let timer = null;
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

function createRuntime(state) {
  return {
    ...state,
    registration: null,
    registrationPromise: null,
    installingWorker: null,
    activationWorker: null,
    updateInterval: null,
    reloadStarted: false,
    listenersAttached: false,
    startupRestartAttempted: false,
  };
}

export function usePwaUpdate() {
  const updateAvailable = useState("pwa-update-available", () => false);
  const refreshing = useState("pwa-update-refreshing", () => false);
  const reloadRequired = useState("pwa-reload-required", () => false);
  const startupFinished = useState("pwa-startup-finished", () => false);

  function currentRuntime() {
    if (!runtime) {
      runtime = createRuntime({
        updateAvailable,
        refreshing,
        reloadRequired,
        startupFinished,
      });
    }
    return runtime;
  }

  function syncUpdateAvailable(activeRuntime) {
    const waiting =
      navigator.serviceWorker.controller &&
      activeRuntime.registration?.waiting?.state === "installed";
    activeRuntime.updateAvailable.value =
      activeRuntime.reloadRequired.value || Boolean(waiting);
  }

  function observeInstallingWorker(activeRuntime, worker) {
    if (!worker || worker === activeRuntime.installingWorker) return;
    activeRuntime.installingWorker = worker;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" || worker.state === "redundant") {
        syncUpdateAvailable(activeRuntime);
      }
    });
  }

  function inspectRegistration(activeRuntime) {
    observeInstallingWorker(
      activeRuntime,
      activeRuntime.registration?.installing,
    );
    syncUpdateAvailable(activeRuntime);
  }

  function reloadApplication(activeRuntime) {
    if (activeRuntime.reloadStarted) return;
    activeRuntime.reloadStarted = true;
    window.location.reload();
  }

  function hasStartupRestartGuard(activeRuntime) {
    if (activeRuntime.startupRestartAttempted) return true;
    try {
      return sessionStorage.getItem(STARTUP_RESTART_GUARD) === "attempted";
    } catch (error) {
      console.warn("[ServiceWorker] Startup restart guard unavailable:", error);
      return false;
    }
  }

  function setStartupRestartGuard(activeRuntime) {
    activeRuntime.startupRestartAttempted = true;
    try {
      sessionStorage.setItem(STARTUP_RESTART_GUARD, "attempted");
    } catch (error) {
      console.warn("[ServiceWorker] Startup restart guard unavailable:", error);
    }
  }

  function clearStartupRestartGuard(activeRuntime) {
    activeRuntime.startupRestartAttempted = false;
    try {
      sessionStorage.removeItem(STARTUP_RESTART_GUARD);
    } catch (error) {
      console.warn("[ServiceWorker] Startup restart guard unavailable:", error);
    }
  }

  function handleControllerChange(activeRuntime) {
    if (activeRuntime.activationWorker) {
      reloadApplication(activeRuntime);
      return;
    }
    if (
      !activeRuntime.startupFinished.value &&
      !hasStartupRestartGuard(activeRuntime)
    ) {
      setStartupRestartGuard(activeRuntime);
      reloadApplication(activeRuntime);
      return;
    }
    activeRuntime.reloadRequired.value = true;
    activeRuntime.updateAvailable.value = true;
  }

  function attachListeners(activeRuntime) {
    if (activeRuntime.listenersAttached) return;
    activeRuntime.listenersAttached = true;
    activeRuntime.registration.addEventListener("updatefound", () => {
      observeInstallingWorker(
        activeRuntime,
        activeRuntime.registration.installing,
      );
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      handleControllerChange(activeRuntime);
    });
  }

  async function ensureRegistration(activeRuntime) {
    if (activeRuntime.registration) return activeRuntime.registration;
    if (!activeRuntime.registrationPromise) {
      activeRuntime.registrationPromise = registerServiceWorker()
        .then((registration) => {
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
    return activeRuntime.registrationPromise;
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

  async function activateWaitingWorker(mode) {
    const activeRuntime = currentRuntime();
    const worker = activeRuntime.registration?.waiting;
    if (!worker || worker.state !== "installed") {
      inspectRegistration(activeRuntime);
      return false;
    }

    activeRuntime.activationWorker = worker;
    activeRuntime.refreshing.value = mode === "active";
    worker.postMessage({ type: "SKIP_WAITING" });
    await waitForState(worker, ["activated", "redundant"], ACTIVATION_WAIT_MS);

    if (
      worker.state === "activated" ||
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
    if (
      import.meta.dev ||
      !import.meta.client ||
      !("serviceWorker" in navigator)
    ) {
      startupFinished.value = true;
      return;
    }

    const activeRuntime = currentRuntime();
    try {
      await ensureRegistration(activeRuntime);
      await checkForUpdate();

      if (!activeRuntime.registration?.waiting) {
        clearStartupRestartGuard(activeRuntime);
        return;
      }

      if (hasStartupRestartGuard(activeRuntime)) {
        syncUpdateAvailable(activeRuntime);
        return;
      }

      setStartupRestartGuard(activeRuntime);
      await activateWaitingWorker("startup");
    } catch (error) {
      console.warn("[ServiceWorker] Startup update failed:", error);
    } finally {
      startupFinished.value = true;
    }
  }

  function startActiveMonitoring() {
    if (
      import.meta.dev ||
      !import.meta.client ||
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
    runStartupUpdate,
    startActiveMonitoring,
    activateUpdate,
  };
}
