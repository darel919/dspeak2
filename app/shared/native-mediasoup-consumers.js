import {
  asError,
  nativeRemoteFeedKey,
  waitFor,
} from "./native-mediasoup-utils.js";
import { isPairedScreenAudio } from "./media-source-ownership.js";

export function requestConsumer(session, producerId) {
  if (!producerId || producersHasId(session, producerId)) return false;
  if (!session.recvTransport || !session.device) {
    session.pendingConsumers.add(producerId);
    session.requestedConsumers.add(producerId);
    return false;
  }
  clearTimeout(session.consumerRetryTimers.get(producerId));
  session.consumerRetryTimers.delete(producerId);
  session.pendingConsumers.delete(producerId);
  if (
    session.requestedConsumers.has(producerId) ||
    [...session.consumers.values()].some(
      (entry) => entry.producerId === producerId,
    )
  )
    return false;
  session.requestedConsumers.add(producerId);
  const requestId = session.requestId("consume");
  try {
    session.sendOrThrow(
      {
        type: "consume",
        data: {
          requestId,
          transportId: session.recvTransport.id,
          producerId,
          rtpCapabilities: session.lastSentClientRtpCapabilities,
        },
      },
      "SFU consumer request",
    );
  } catch (_) {
    session.requestedConsumers.delete(producerId);
    session.pendingConsumers.add(producerId);
  }
  return true;
}

export function producersHasId(session, producerId) {
  return [...session.producers.values()].some(
    (entry) => entry.id === producerId,
  );
}

export async function createConsumer(session, data) {
  session.requestedConsumers.delete(data.producerId);
  session.pendingConsumers.delete(data.producerId);
  session.consumerRetryAttempts.delete(data.producerId);
  clearTimeout(session.consumerRetryTimers.get(data.producerId));
  session.consumerRetryTimers.delete(data.producerId);
  if (!session.recvTransport || session.consumers.has(data.id)) return null;
  const mediaRevision = session.mediaRevision;
  session.lastReceivedConsumerParams = data;
  const previousDirection = session.pendingNativeDirection;
  session.pendingNativeDirection = "recv";
  try {
    const result = await session.invoke("media_consume", {
      id: data.id,
      producerId: data.producerId,
      kind: data.kind,
      rtpParameters: data.rtpParameters,
      appData: {
        userId: data.userId,
        source: data.source,
        ownerSource: data.ownerSource || null,
      },
    });
    const consumerId = result?.id || data.id;
    if (session.closed || mediaRevision !== session.mediaRevision) {
      await session
        .invoke("media_close_consumer", {
          consumerId,
        })
        .catch(() => {});
      return null;
    }
    const source = data.source || data.kind;
    const feedKey = nativeRemoteFeedKey(data.userId, source, consumerId);
    const previous = [...session.consumers.values()].find(
      (candidate) => candidate.key === feedKey,
    );
    if (previous) closeConsumer(session, previous);
    const entry = {
      key: feedKey,
      id: consumerId,
      consumerId,
      producerId: result?.producerId || data.producerId,
      userId: data.userId,
      source,
      ownerSource: data.ownerSource || null,
      kind: result?.kind || data.kind,
      track: null,
      stream: null,
      native: true,
      playback: data.kind === "audio" ? "coreaudio" : "native-frame",
      frame: null,
      receiving: false,
      desiredReceiving: false,
      receivingRevision: 0,
      closed: false,
    };
    session.consumers.set(entry.consumerId, entry);
    if (entry.kind === "audio") session.remoteAudioFeeds.set(entry.key, entry);
    if (entry.kind === "video") session.remoteVideoFeeds.set(entry.key, entry);
    if (shouldReceive(session, entry.userId, entry.source, entry.ownerSource))
      await setConsumerReceiving(session, entry, true);
    await session.applyJitterBufferConfig(entry);
    session.onRemoteTrack?.(entry);
    session._emitState();
    return entry;
  } finally {
    session.pendingNativeDirection = previousDirection;
  }
}

export function setRemoteReceiving(
  session,
  userIdOrKey,
  sourceOrReceiving,
  receivingValue,
) {
  if (typeof sourceOrReceiving === "boolean" && receivingValue === undefined) {
    const entry =
      session.consumers.get(userIdOrKey) ||
      session.remoteVideoFeeds.get(userIdOrKey) ||
      session.remoteAudioFeeds.get(userIdOrKey);
    return entry
      ? setRemoteReceiving(
          session,
          entry.userId,
          entry.source,
          sourceOrReceiving,
        )
      : Promise.resolve(false);
  }
  const userId = userIdOrKey;
  const source = sourceOrReceiving;
  const receiving = receivingValue;
  const operations = [];
  session.remoteReceiving.set(
    `${String(userId)}:${String(source)}`,
    Boolean(receiving),
  );
  for (const entry of session.consumers.values()) {
    if (String(entry.userId) === String(userId) && entry.source === source)
      operations.push(setConsumerReceiving(session, entry, receiving));
  }
  return Promise.all(operations);
}

export function shouldReceive(session, userId, source, ownerSource = null) {
  const key = `${String(userId)}:${String(source)}`;
  if (session.remoteReceiving.has(key)) return session.remoteReceiving.get(key);
  return !isPairedScreenAudio({ source, ownerSource });
}

export function setConsumerVolume(session, userId, source, volume) {
  const normalized = Math.max(0, Math.min(2, Number(volume)));
  const operations = [...session.consumers.values()]
    .filter(
      (entry) =>
        String(entry.userId) === String(userId) &&
        (!source || entry.source === source),
    )
    .map((entry) =>
      session.invoke("media_set_consumer_volume", {
        consumerId: entry.consumerId,
        volume: normalized,
      }),
    );
  return Promise.all(operations);
}

export function sendParticipantVoiceState(session, state = {}) {
  return session.signaling?.send?.({
    type: "participant-voice-state",
    data: {
      muted: Boolean(state.muted),
      deafened: Boolean(state.deafened),
    },
  });
}

export async function setConsumerReceiving(session, entry, receiving) {
  if (!entry || entry.closed) return false;
  const desired = Boolean(receiving);
  entry.desiredReceiving = desired;
  entry.receivingRevision = (entry.receivingRevision || 0) + 1;
  const revision = entry.receivingRevision;
  const requestId = session.requestId(
    desired ? "resume-consumer" : "pause-consumer",
  );
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const retryRequestId =
      attempt === 0
        ? requestId
        : session.requestId(desired ? "resume-consumer" : "pause-consumer");
    const acknowledgement = waitFor(
      session.pending,
      retryRequestId,
      session.consumerControlTimeoutMs,
      `SFU consumer ${desired ? "resume" : "pause"}`,
    );
    try {
      session.sendOrThrow(
        {
          type: desired ? "resume-consumer" : "pause-consumer",
          data: {
            consumerId: entry.consumerId,
            requestId: retryRequestId,
            revision,
          },
        },
        `SFU consumer ${desired ? "resume" : "pause"}`,
      );
    } catch (error) {
      session.pending.get(retryRequestId)?.reject(error);
    }
    try {
      const result = await acknowledgement;
      if (result?.consumerClosed) {
        if (entry.receivingRevision === revision) entry.receiving = false;
        closeConsumer(session, entry);
        return false;
      }
      if (entry.receivingRevision !== revision) return false;
      await session.invoke("media_set_consumer_enabled", {
        consumerId: entry.consumerId,
        enabled: desired,
      });
      if (entry.closed || entry.receivingRevision !== revision) return false;
      entry.receiving = desired;
      session._emitState();
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  if (entry.receivingRevision === revision) entry.receiving = false;
  session._emitState();
  throw lastError;
}

export function resolveConsumerControl(session, data, receiving) {
  const entry = session.consumers.get(data.consumerId);
  if (!entry) {
    session.pending
      .get(data.requestId)
      ?.resolve({ ...data, consumerClosed: true });
    return;
  }
  session.pending.get(data.requestId)?.resolve({ ...data, receiving });
}

export function closeConsumerByProducer(session, producerId) {
  session.requestedConsumers.delete(producerId);
  session.pendingConsumers.delete(producerId);
  session.consumerRetryAttempts.delete(producerId);
  clearTimeout(session.consumerRetryTimers.get(producerId));
  session.consumerRetryTimers.delete(producerId);
  const entry = [...session.consumers.values()].find(
    (candidate) => candidate.producerId === producerId,
  );
  if (entry) closeConsumer(session, entry);
}

export function closeConsumer(session, entry, { releaseNative = true } = {}) {
  if (!entry?.consumerId || entry.closed) return false;
  entry.closed = true;
  session.consumers.delete(entry.consumerId);
  session.remoteAudioFeeds.delete(entry.key);
  session.remoteVideoFeeds.delete(entry.key);
  entry.receiving = false;
  session.onRemoteTrackEnded?.(entry);
  if (releaseNative)
    session
      .invoke("media_close_consumer", { consumerId: entry.consumerId })
      .catch((error) =>
        session.onError?.(asError(error, "Native consumer close failed")),
      );
  session._emitState();
  return true;
}
