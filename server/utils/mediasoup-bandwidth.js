import { withMediaOperationTimeout } from "./media-session-lifecycle.js";
import { calculateSfuClientOutgoingBitrate } from "./mediasoup-transport.js";

function receiveTransports(state) {
  return [...state.sessions.values()]
    .flatMap((session) => [...session.transports.values()])
    .filter(
      (transport) =>
        !transport.closed && transport.appData?.direction === "recv",
    );
}

export function queueSfuBandwidthRebalance(state) {
  state.bandwidthRebalance = state.bandwidthRebalance
    .catch(() => {})
    .then(async () => {
      const transports = receiveTransports(state);
      if (!transports.length) return;
      const bitrate = calculateSfuClientOutgoingBitrate(
        transports.length,
        state.config.maxClientOutgoingBitrate,
        state.config.maxServerOutgoingBitrate,
      );
      await Promise.all(
        transports.map((transport) =>
          withMediaOperationTimeout(
            transport.setMaxOutgoingBitrate(bitrate),
            `SFU transport ${transport.id} bitrate rebalance`,
          ),
        ),
      );
    });
  state.bandwidthRebalance.catch((error) =>
    console.error("[SFU] failed to rebalance outgoing bandwidth", error),
  );
  return state.bandwidthRebalance;
}
