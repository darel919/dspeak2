export interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener?: (
    type: "release",
    listener: () => void,
    options?: { once?: boolean },
  ) => void;
}
export interface CallWakeLockTarget {
  visibilityState?: string;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
}
export interface CallWakeLockApi {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
}
