import { useRuntimeConfig } from "#imports";

export const SERVICE_WORKER_OPTIONS = Object.freeze({
  type: "module",
  updateViaCache: "none",
});

let registrationRequest = null;

export function getServiceWorkerUrl() {
  if (import.meta.dev) return "/dev-sw.js?dev-sw";
  const buildId = useRuntimeConfig().app.buildId;
  return `/sw.js?build=${encodeURIComponent(buildId)}`;
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  if (!registrationRequest) {
    registrationRequest = navigator.serviceWorker
      .register(getServiceWorkerUrl(), SERVICE_WORKER_OPTIONS)
      .catch((error) => {
        registrationRequest = null;
        throw error;
      });
  }
  return registrationRequest;
}
