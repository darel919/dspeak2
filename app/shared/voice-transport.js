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
import {
  getAudioCodecPolicy,
  toMediasoupProducerOptions,
} from "#shared/audio-codec-policy.js";

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
  const policy = getAudioCodecPolicy("microphone", stereo);
  const bitrate = Number(maxBitrate);
  const producerOptions = toMediasoupProducerOptions(policy, track);
  if (Number.isFinite(bitrate) && bitrate > 0) {
    producerOptions.encodings[0].maxBitrate = Math.floor(bitrate);
  }
  return producerOptions;
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
