import { hasTauriRuntimeMarker } from "./desktop-capture.ts";

export const SERVICE_WORKER_OPTIONS = Object.freeze({
  type: "module",
  updateViaCache: "none",
});

export const SERVICE_WORKER_URL = import.meta.dev
  ? "/dev-sw.js?dev-sw"
  : "/sw.js";

const TRUSTED_TYPES_POLICY_NAME = "dspeak-service-worker";
interface TrustedTypesPolicyLike {
  createScriptURL: (value: string) => unknown;
}
interface TrustedTypesFactoryLike {
  createPolicy: (
    name: string,
    rules: { createScriptURL: (value: string) => string },
  ) => TrustedTypesPolicyLike;
}
let registrationRequest =
  null as Promise<ServiceWorkerRegistration | null> | null;
let trustedTypesPolicy: TrustedTypesPolicyLike | null = null;

function serviceWorkerScriptUrl() {
  const trustedTypes = (
    globalThis as typeof globalThis & {
      trustedTypes?: TrustedTypesFactoryLike;
    }
  ).trustedTypes;
  if (!trustedTypes) return SERVICE_WORKER_URL;
  if (!trustedTypesPolicy) {
    trustedTypesPolicy = trustedTypes.createPolicy(TRUSTED_TYPES_POLICY_NAME, {
      createScriptURL(value: string) {
        if (value !== SERVICE_WORKER_URL)
          throw new TypeError("Untrusted service worker URL");
        return value;
      },
    });
  }
  const policy = trustedTypesPolicy;
  return policy
    ? String(policy.createScriptURL(SERVICE_WORKER_URL))
    : SERVICE_WORKER_URL;
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (hasTauriRuntimeMarker()) return Promise.resolve(null);
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
