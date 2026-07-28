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
