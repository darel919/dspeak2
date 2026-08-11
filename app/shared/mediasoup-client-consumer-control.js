export async function setMediasoupConsumerReceiving(session, entry, receiving) {
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

export function closeMediasoupConsumerByProducer(session, producerId) {
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

export function handleMediasoupServerError(session, data) {
  const error = new Error(
    data?.message || data?.error || "SFU signaling request failed",
  );
  let handled = false;
  if (data?.requestId) {
    const produceRequest = session.pendingProduce.get(data.requestId);
    const pendingRequest = session.pending.get(data.requestId);
    if (produceRequest) {
      handled = true;
      produceRequest.reject(error);
    }
    if (pendingRequest) {
      handled = true;
      pendingRequest.reject(error);
    }
  }
  if (data?.requestType === "consume" && data.producerId) {
    handled = true;
    session.requestedConsumers.delete(data.producerId);
    session.pendingConsumers.delete(data.producerId);
    const attempts = session.consumerRetryAttempts.get(data.producerId) || 0;
    if (!session.closed && attempts < 2) {
      session.consumerRetryAttempts.set(data.producerId, attempts + 1);
      const delay = session.consumerRetryDelayMs * 2 ** attempts;
      const timer = setTimeout(() => {
        session.consumerRetryTimers.delete(data.producerId);
        session.requestConsumer(data.producerId);
      }, delay);
      session.consumerRetryTimers.set(data.producerId, timer);
    }
  }
  if (data?.requestType === "connect-transport" && data.transportId)
    handled = true;
  if (
    [
      "get-rtp-capabilities",
      "client-rtp-capabilities",
      "create-transport",
    ].includes(data?.requestType)
  ) {
    handled = true;
    session.readyReject?.(error);
    session.resetReadiness();
  }
  return handled;
}
