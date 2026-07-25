export const SERVICE_WORKER_OPTIONS = Object.freeze({
  type: "module",
  updateViaCache: "none",
});

export const SERVICE_WORKER_URL = import.meta.dev
  ? "/dev-sw.js?dev-sw"
  : "/sw.js";

let registrationRequest = null;

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  if (!registrationRequest) {
    registrationRequest = navigator.serviceWorker
      .register(SERVICE_WORKER_URL, SERVICE_WORKER_OPTIONS)
      .catch((error) => {
        registrationRequest = null;
        throw error;
      });
  }
  return registrationRequest;
}
