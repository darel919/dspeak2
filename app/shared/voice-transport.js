import {
  getConnectionQualityBars,
  getConnectionQualityLabel,
} from "./connection-quality.js";
import {
  mapPeerRoundTripTimes,
  mapPeerConnectionMetrics,
  getAverageJitterBufferDelayMs,
  getRtcSignalMetrics,
  getTransportRecoveryDelayMs,
  getReconnectDelayMs,
  getActiveMediaDirections,
} from "#shared/media-metrics.js";

export {
  mapPeerRoundTripTimes,
  mapPeerConnectionMetrics,
  getAverageJitterBufferDelayMs,
  getRtcSignalMetrics,
  getTransportRecoveryDelayMs,
  getReconnectDelayMs,
  getActiveMediaDirections,
};

export function buildVoiceProducerOptions(track, maxBitrate, stereo = false) {
  const bitrate = Number(maxBitrate);
  return {
    track,
    encodings: [
      {
        ...(Number.isFinite(bitrate) && bitrate > 0
          ? { maxBitrate: Math.floor(bitrate) }
          : {}),
        priority: "high",
        networkPriority: "high",
      },
    ],
    codecOptions: {
      opusDtx: false,
      opusFec: true,
      opusNack: true,
      opusStereo: stereo,
      opusPtime: 10,
    },
  };
}

export function getAudioBitrateBps(
  source,
  channelBitrateKbps,
  systemAudioBitrateKbps,
) {
  const channel = Number(channelBitrateKbps);
  const requested =
    source === "screen-audio" ? Number(systemAudioBitrateKbps) : channel;
  const limits = [channel, requested].filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  return limits.length ? Math.min(...limits) * 1000 : null;
}
