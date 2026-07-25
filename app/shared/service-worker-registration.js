export const SERVICE_WORKER_OPTIONS = Object.freeze({
  type: "module",
  updateViaCache: "none",
});

export const SERVICE_WORKER_URL = import.meta.dev
  ? "/dev-sw.js?dev-sw"
  : "/sw.js";

const TRUSTED_TYPES_POLICY_NAME = "dspeak-service-worker";
let registrationRequest = null;
let trustedTypesPolicy = null;

function serviceWorkerScriptUrl() {
  if (!globalThis.trustedTypes) return SERVICE_WORKER_URL;
  if (!trustedTypesPolicy) {
    trustedTypesPolicy = globalThis.trustedTypes.createPolicy(
      TRUSTED_TYPES_POLICY_NAME,
      {
        createScriptURL(value) {
          if (value !== SERVICE_WORKER_URL)
            throw new TypeError("Untrusted service worker URL");
          return value;
        },
      },
    );
  }
  return trustedTypesPolicy.createScriptURL(SERVICE_WORKER_URL);
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  if (!registrationRequest) {
    registrationRequest = navigator.serviceWorker
      .register(serviceWorkerScriptUrl(), SERVICE_WORKER_OPTIONS)
      .catch((error) => {
        registrationRequest = null;
        throw error;
      });
  }
  return registrationRequest;
}
