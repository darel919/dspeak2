import assert from "node:assert/strict";
import test from "node:test";
import {
  broadcastGlobally,
  broadcastToChannel,
  broadcastToRoom,
  broadcastToUser,
  publishToRealtime,
  setRealtimePublisherForTests,
} from "../server/utils/dspeak-realtime.js";

function createFakePublisher() {
  const sent = [];
  const channels = new Map();
  return {
    sent,
    channels,
    channel(name) {
      if (!channels.has(name)) {
        channels.set(name, {
          name,
          httpSend: async (_event, payload) => {
            sent.push({ topic: name, payload });
          },
        });
      }
      return channels.get(name);
    },
  };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("broadcast helpers publish to their reserved topics", async () => {
  const publisher = createFakePublisher();
  setRealtimePublisherForTests(publisher);

  const channelEvent = { type: "new_message", data: { id: "m-1" } };
  const userEvent = { type: "notifications_changed" };
  const globalEvent = { type: "profile_updated", data: { id: "u-1" } };
  const roomEvent = { type: "voice-presence", data: { channelId: "c-1" } };

  broadcastToChannel("channel-1", channelEvent);
  broadcastToUser("user-1", userEvent);
  broadcastGlobally(globalEvent);
  broadcastToRoom("room-1", roomEvent);
  await flushAsyncWork();

  assert.deepEqual(publisher.sent, [
    { topic: "chat:channel-1", payload: channelEvent },
    { topic: "notify:user-1", payload: userEvent },
    { topic: "global", payload: globalEvent },
    { topic: "room:room-1", payload: roomEvent },
  ]);
});

test("publishToRealtime reuses one channel per topic", async () => {
  const publisher = createFakePublisher();
  setRealtimePublisherForTests(publisher);

  await publishToRealtime("chat:channel-1", { type: "a" });
  await publishToRealtime("chat:channel-1", { type: "b" });
  await publishToRealtime("chat:channel-2", { type: "c" });

  assert.equal(publisher.channels.size, 2);
  assert.equal(publisher.sent.length, 3);
});

test("publisher failures evict the cached channel and recover on retry", async () => {
  const publisher = createFakePublisher();
  let failing = true;
  publisher.channel("chat:flaky").httpSend = async () => {
    if (failing) throw new Error("realtime unavailable");
    publisher.sent.push({ topic: "chat:flaky", payload: { type: "retry" } });
  };
  setRealtimePublisherForTests(publisher);

  await publishToRealtime("chat:flaky", { type: "boom" });
  failing = false;
  await publishToRealtime("chat:flaky", { type: "retry" });

  assert.deepEqual(publisher.sent, [
    { topic: "chat:flaky", payload: { type: "retry" } },
  ]);
});

test("publishing without a configured publisher is a no-op", async () => {
  setRealtimePublisherForTests(null);
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";

  await publishToRealtime("chat:channel-1", { type: "noop" });

  process.env.SUPABASE_URL = previousUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
});
