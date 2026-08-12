import type { Ref } from "vue";

export interface PwaUpdateState {
  updateAvailable: Ref<boolean>;
  refreshing: Ref<boolean>;
  reloadRequired: Ref<boolean>;
  startupFinished: Ref<boolean>;
  startupUpdateStatus: Ref<string>;
}

export interface PwaUpdateRuntime extends PwaUpdateState {
  registration: ServiceWorkerRegistration | null;
  registrationPromise: Promise<ServiceWorkerRegistration | null> | null;
  installingWorker: ServiceWorker | null;
  startupWorker: ServiceWorker | null;
  activationWorker: ServiceWorker | null;
  updateInterval: number | null;
  reloadStarted: boolean;
  listenersAttached: boolean;
  startupRestartAttempted: string | null;
}
