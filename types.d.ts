interface Error {
  code?: string;
  details?: unknown;
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
  connection?: NetworkInformation;
  deviceMemory?: number;
  userAgentData?: NavigatorUAData;
}

interface NetworkInformation {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: EventTarget["addEventListener"];
  removeEventListener?: EventTarget["removeEventListener"];
}

interface NavigatorUAData {
  platform?: string;
}

interface AudioContext {
  setSinkId?: (sinkId: string) => Promise<void>;
}

interface HTMLAudioElement {
  playsInline: boolean;
}

interface ServiceWorkerRegistration {
  sync?: { register: (tag: string) => Promise<void> };
}

declare const webkitAudioContext: typeof AudioContext | undefined;
