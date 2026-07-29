import { randomUUID } from "node:crypto";

const instanceKey = Symbol.for("dspeak.stream-manager");

function createStreamManager() {
  const streams = new Map();

  return {
    registerStream(channelId, state) {
      if (!channelId) throw new Error("channelId is required");
      streams.set(String(channelId), {
        ...state,
        channelId: String(channelId),
      });
    },

    getStream(channelId) {
      return streams.get(String(channelId)) || null;
    },

    unregisterStream(channelId) {
      return streams.delete(String(channelId));
    },

    getStreamByKey(streamKey) {
      if (!streamKey) return null;
      for (const state of streams.values()) {
        if (state.streamKey === streamKey) return state.channelId;
      }
      return null;
    },

    hasActiveStream(channelId) {
      return streams.has(String(channelId));
    },

    getActiveStreams() {
      return [...streams.values()];
    },

    getStreamCount() {
      return streams.size;
    },

    hasStreamWithoutRelay(channelId) {
      const stream = streams.get(String(channelId));
      if (!stream) return false;
      if (stream.relayStarting) return false;
      return !stream.plainTransport && !stream.producer;
    },

    // Sync stream state to PocketBase (for persistence across restarts)
    async syncToDatabase(pb) {
      for (const stream of streams.values()) {
        if (stream.relayStarting || stream.plainTransport || stream.producer) {
          await pb.collection("dspeak_rooms_channels").update(stream.channelId, {
            stream_active: true,
            stream_key: stream.streamKey,
          }).catch(() => {});
        }
      }
    },
  };
}

export function getStreamManager() {
  if (!globalThis[instanceKey]) {
    globalThis[instanceKey] = createStreamManager();
  }
  return globalThis[instanceKey];
}

export function generateStreamKey() {
  return randomUUID();
}

// Reconcile stream state with PocketBase on server startup
// Resets stream_active=false for channels that have no active relay
export async function reconcileStreamState(pb) {
  try {
    const activeChannels = await pb.collection("dspeak_rooms_channels").getList(1, 500, {
      filter: "stream_active = true",
    });

    const manager = getStreamManager();
    let reconciled = 0;

    for (const channel of activeChannels.items) {
      const stream = manager.getStream(channel.id);
      if (!stream || !stream.plainTransport || !stream.producer) {
        // No active relay - reset stream_active
        await pb.collection("dspeak_rooms_channels").update(channel.id, {
          stream_active: false,
          stream_metadata: null,
        }).catch(() => {});
        reconciled++;
      }
    }

    if (reconciled > 0) {
      console.log(`[StreamManager] Reconciled ${reconciled} stale stream_active entries`);
    }
  } catch (error) {
    console.error("[StreamManager] Stream reconciliation failed:", error);
  }
}
