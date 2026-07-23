export const SERVICE_WORKER_OPTIONS = Object.freeze({
  type: "module",
  updateViaCache: "none",
});

export const SERVICE_WORKER_URL = import.meta.dev
  ? "/dev-sw.js?dev-sw"
  : "/sw.js";

let registrationRequest = null;

function isDSpeakServiceWorker(registration) {
  return [registration.active, registration.installing, registration.waiting]
    .filter(Boolean)
    .some((worker) => new URL(worker.scriptURL).pathname === "/sw.js");
}

async function removeLegacyServiceWorkerRegistrations() {
  const expectedScope = new URL("/", window.location.origin).href;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter(
        (registration) =>
          registration.scope !== expectedScope &&
          isDSpeakServiceWorker(registration),
      )
      .map((registration) => registration.unregister()),
  );
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  if (!registrationRequest) {
    registrationRequest = removeLegacyServiceWorkerRegistrations()
      .then(() =>
        navigator.serviceWorker.register(
          SERVICE_WORKER_URL,
          SERVICE_WORKER_OPTIONS,
        ),
      )
      .catch((error) => {
        registrationRequest = null;
        throw error;
      });
  }
  return registrationRequest;
}
