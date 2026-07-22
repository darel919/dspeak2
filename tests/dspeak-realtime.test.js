import assert from "node:assert/strict";
import test from "node:test";
import {
  addGlobalSubscriber,
  broadcastGlobally,
  removeGlobalSubscriber,
} from "../server/utils/dspeak-realtime.js";

test("global realtime events reach every connected subscriber", () => {
  const firstMessages = [];
  const secondMessages = [];
  const first = { send: (message) => firstMessages.push(JSON.parse(message)) };
  const second = {
    send: (message) => secondMessages.push(JSON.parse(message)),
  };
  addGlobalSubscriber(first);
  addGlobalSubscriber(second);

  const event = {
    type: "profile_updated",
    data: { id: "user-1", display_name: "Updated Name" },
  };
  broadcastGlobally(event);

  assert.deepEqual(firstMessages, [event]);
  assert.deepEqual(secondMessages, [event]);
  removeGlobalSubscriber(first);
  removeGlobalSubscriber(second);
});

test("failed global subscribers are removed without blocking delivery", () => {
  const messages = [];
  const failed = {
    send() {
      throw new Error("socket closed");
    },
  };
  const healthy = { send: (message) => messages.push(JSON.parse(message)) };
  addGlobalSubscriber(failed);
  addGlobalSubscriber(healthy);

  broadcastGlobally({ type: "first" });
  broadcastGlobally({ type: "second" });

  assert.deepEqual(messages, [{ type: "first" }, { type: "second" }]);
  removeGlobalSubscriber(healthy);
});
