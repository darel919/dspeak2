export const DESKTOP_OAUTH_FLOW_ID_KEY = "dspeak:desktop-oauth-flow-id";
export const DESKTOP_OAUTH_STATE_KEY = "dspeak:desktop-oauth-state";
export const DESKTOP_OAUTH_STARTED_AT_KEY = "dspeak:desktop-oauth-started-at";
export const DESKTOP_OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;

export type DesktopOAuthStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

type DesktopOAuthClient = {
  auth: {
    exchangeCodeForSession: (
      code: string,
      options?: { flowId?: string },
    ) => Promise<unknown>;
  };
};

function defaultStorage(): DesktopOAuthStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createDesktopOAuthStateStore(
  storage: DesktopOAuthStorage | null = defaultStorage(),
) {
  function remove(key: string) {
    try {
      storage?.removeItem(key);
    } catch (error) {
      console.warn(`[DesktopAuth] Could not clear ${key}:`, error);
    }
  }

  function clear() {
    remove(DESKTOP_OAUTH_FLOW_ID_KEY);
    remove(DESKTOP_OAUTH_STATE_KEY);
    remove(DESKTOP_OAUTH_STARTED_AT_KEY);
  }

  function isExpired() {
    if (!storage) return false;
    try {
      const startedAt = Number(
        storage.getItem(DESKTOP_OAUTH_STARTED_AT_KEY) || "",
      );
      return (
        !Number.isFinite(startedAt) ||
        Date.now() - startedAt > DESKTOP_OAUTH_ATTEMPT_TTL_MS
      );
    } catch (error) {
      console.warn("[DesktopAuth] Could not read OAuth attempt age:", error);
      return true;
    }
  }

  function read(key: string) {
    if (!storage) return "";
    try {
      const state = storage.getItem(DESKTOP_OAUTH_STATE_KEY);
      if (!state) return "";
      if (isExpired()) {
        clear();
        return "";
      }
      return storage.getItem(key) || "";
    } catch (error) {
      console.warn(`[DesktopAuth] Could not read ${key}:`, error);
      return "";
    }
  }

  function begin(state: string) {
    clear();
    if (!storage || !state) return false;
    try {
      storage.setItem(DESKTOP_OAUTH_STATE_KEY, state);
      storage.setItem(DESKTOP_OAUTH_STARTED_AT_KEY, String(Date.now()));
      return true;
    } catch (error) {
      clear();
      console.warn("[DesktopAuth] Could not persist OAuth state:", error);
      return false;
    }
  }

  function setFlowId(flowId: string) {
    if (!storage) return !flowId;
    try {
      if (!read(DESKTOP_OAUTH_STATE_KEY) || !flowId) {
        remove(DESKTOP_OAUTH_FLOW_ID_KEY);
        return !flowId;
      }
      storage.setItem(DESKTOP_OAUTH_FLOW_ID_KEY, flowId);
      return true;
    } catch (error) {
      console.warn(
        "[DesktopAuth] Could not persist OAuth flow selector:",
        error,
      );
      return false;
    }
  }

  return {
    begin,
    clear,
    getFlowId: () => read(DESKTOP_OAUTH_FLOW_ID_KEY),
    getState: () => read(DESKTOP_OAUTH_STATE_KEY),
    hasPendingAttempt: () => Boolean(read(DESKTOP_OAUTH_STATE_KEY)),
    setFlowId,
  };
}

export function desktopOAuthExchangeOptions(flowId: string) {
  return flowId ? { flowId } : undefined;
}

export function isDesktopOAuthStateValid(expectedState: string, state: string) {
  return Boolean(expectedState) && expectedState === state;
}

export function exchangeDesktopOAuthCode<T = unknown>(
  client: DesktopOAuthClient,
  code: string,
  flowId: string,
) {
  return client.auth.exchangeCodeForSession(
    code,
    desktopOAuthExchangeOptions(flowId),
  ) as Promise<T>;
}
