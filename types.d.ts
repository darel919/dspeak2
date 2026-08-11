interface Error {
  code?: string;
  details?: any;
  errorCode?: string;
  status?: number;
  statusCode?: number;
}

interface Window {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  webkitAudioContext?: typeof AudioContext;
}

interface Navigator {
  connection?: any;
  deviceMemory?: number;
  userAgentData?: any;
}

interface AudioContext {
  setSinkId?: (sinkId: string) => Promise<void>;
}

interface HTMLAudioElement {
  playsInline: boolean;
}

interface ServiceWorkerRegistration {
  sync?: any;
}

declare const webkitAudioContext: typeof AudioContext | undefined;
