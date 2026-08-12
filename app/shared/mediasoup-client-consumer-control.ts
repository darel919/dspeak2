import type {
  MediasoupClientSessionLike,
  MediasoupConsumerEntry,
} from "./types/mediasoup-client.ts";

export async function setMediasoupConsumerReceiving(
  session: MediasoupClientSessionLike,
  entry: MediasoupConsumerEntry,
  receiving: boolean,
) {
  const desired = Boolean(receiving);
  entry.desiredReceiving = desired;
  entry.receivingRevision = (entry.receivingRevision || 0) + 1;
  const revision = entry.receivingRevision;
  const operation = desired ? "resume-consumer" : "pause-consumer";
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const requestId = session.requestId(operation);
    const acknowledgement = session.waitForPending(
      requestId,
      `SFU ${desired ? "consumer resume" : "consumer pause"}`,
      session.consumerControlTimeoutMs,
    );
    try {
      session.sendOrThrow(
        {
          type: operation,
          data: { consumerId: entry.consumer.id, requestId, revision },
        },
        `SFU ${desired ? "consumer resume" : "consumer pause"}`,
      );
    } catch (error) {
      session.pending.get(requestId)?.reject(error);
    }
    try {
      const result = await acknowledgement;
      if (result?.consumerClosed) {
        if (entry.receivingRevision === revision) {
          entry.track.enabled = false;
          entry.receiving = false;
        }
        return false;
      }
      if (entry.receivingRevision !== revision) return false;
      entry.track.enabled = desired;
      entry.receiving = desired;
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  if (entry.receivingRevision === revision) {
    entry.track.enabled = false;
    entry.receiving = false;
  }
  session.onStateChange?.("consumer", "failed", session.connectionState());
  throw lastError;
}

export function closeMediasoupConsumerByProducer(
  session: MediasoupClientSessionLike,
  producerId: string,
) {
  session.requestedConsumers.delete(producerId);
  session.pendingConsumers.delete(producerId);
  session.consumerRetryAttempts.delete(producerId);
  clearTimeout(session.consumerRetryTimers.get(producerId));
  session.consumerRetryTimers.delete(producerId);
  const match = [...session.consumers.values()].find(
    (entry) => entry.producerId === producerId,
  );
  if (!match) return;
  match.consumer.close();
  match.close();
}

export function handleMediasoupServerError(
  session: MediasoupClientSessionLike,
  data: Record<string, unknown>,
) {
  const error = new Error(
    typeof data.message === "string"
      ? data.message
      : typeof data.error === "string"
        ? data.error
        : "SFU signaling request failed",
  );
  let handled = false;
  const requestId = typeof data.requestId === "string" ? data.requestId : null;
  if (requestId) {
    const produceRequest = session.pendingProduce.get(requestId);
    const pendingRequest = session.pending.get(requestId);
    if (produceRequest) {
      handled = true;
      produceRequest.reject(error);
    }
    if (pendingRequest) {
      handled = true;
      pendingRequest.reject(error);
    }
  }
  const producerId =
    typeof data.producerId === "string" ? data.producerId : null;
  if (data.requestType === "consume" && producerId) {
    handled = true;
    session.requestedConsumers.delete(producerId);
    session.pendingConsumers.delete(producerId);
    const attempts = session.consumerRetryAttempts.get(producerId) || 0;
    if (!session.closed && attempts < 2) {
      session.consumerRetryAttempts.set(producerId, attempts + 1);
      const delay = session.consumerRetryDelayMs * 2 ** attempts;
      const timer = setTimeout(() => {
        session.consumerRetryTimers.delete(producerId);
        session.requestConsumer(producerId);
      }, delay);
      session.consumerRetryTimers.set(producerId, timer);
    }
  }
  if (data.requestType === "connect-transport" && data.transportId)
    handled = true;
  if (
    [
      "get-rtp-capabilities",
      "client-rtp-capabilities",
      "create-transport",
    ].includes(data.requestType as string)
  ) {
    handled = true;
    session.readyReject?.(error);
    session.resetReadiness();
  }
  return handled;
}
