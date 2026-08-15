import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDesktopOAuthStateStore,
  exchangeDesktopOAuthCode,
  isDesktopOAuthStateValid,
} from "../app/shared/desktop-oauth-flow.ts";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe("desktop OAuth flow state", () => {
  it("retains the Supabase flow selector after OAuth starts", () => {
    const storage = createStorage();
    const flow = createDesktopOAuthStateStore(storage);

    flow.begin("state-a");
    flow.setFlowId("test-flow");

    assert.equal(flow.getState(), "state-a");
    assert.equal(flow.getFlowId(), "test-flow");
  });

  it("passes the active flow selector to the PKCE exchange", async () => {
    const calls: Array<{ code: string; options?: { flowId?: string } }> = [];
    const client = {
      auth: {
        exchangeCodeForSession: async (
          code: string,
          options?: { flowId?: string },
        ) => {
          calls.push({ code, options });
          return {
            data: { session: { access_token: "session-token" } },
            error: null,
          };
        },
      },
    };

    await exchangeDesktopOAuthCode(client, "test-code", "test-flow");

    assert.deepEqual(calls, [
      { code: "test-code", options: { flowId: "test-flow" } },
    ]);
  });

  it("clears a cancelled flow before starting the next attempt", async () => {
    const storage = createStorage();
    const first = createDesktopOAuthStateStore(storage);
    first.begin("state-a");
    first.setFlowId("flow-a");
    first.clear();

    const second = createDesktopOAuthStateStore(storage);
    second.begin("state-b");
    second.setFlowId("flow-b");
    const calls: string[] = [];
    const client = {
      auth: {
        exchangeCodeForSession: async (
          code: string,
          options?: { flowId?: string },
        ) => {
          calls.push(`${code}:${options?.flowId || ""}`);
          return { data: { session: null }, error: null };
        },
      },
    };

    await exchangeDesktopOAuthCode(client, "callback-b", second.getFlowId());

    assert.deepEqual(calls, ["callback-b:flow-b"]);
    assert.notEqual(second.getFlowId(), "flow-a");
  });

  it("recovers the active selector after the storage owner is recreated", async () => {
    const storage = createStorage();
    const first = createDesktopOAuthStateStore(storage);
    first.begin("state-a");
    first.setFlowId("flow-a");

    const recreated = createDesktopOAuthStateStore(storage);
    assert.equal(recreated.getState(), "state-a");
    assert.equal(recreated.getFlowId(), "flow-a");

    let selectedFlow = "";
    const client = {
      auth: {
        exchangeCodeForSession: async (
          _code: string,
          options?: { flowId?: string },
        ) => {
          selectedFlow = options?.flowId || "";
          return { data: { session: null }, error: null };
        },
      },
    };
    await exchangeDesktopOAuthCode(client, "callback-a", recreated.getFlowId());

    assert.equal(selectedFlow, "flow-a");
  });

  it("blocks a callback with a mismatched dSpeak state before exchange", async () => {
    let exchangeCount = 0;
    const client = {
      auth: {
        exchangeCodeForSession: async () => {
          exchangeCount += 1;
          return { data: { session: null }, error: null };
        },
      },
    };

    if (isDesktopOAuthStateValid("state-a", "state-b"))
      await exchangeDesktopOAuthCode(client, "test-code", "test-flow");

    assert.equal(exchangeCount, 0);
  });
});
