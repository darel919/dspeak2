import {
  asError,
  nativeRemoteFeedKey,
  waitFor,
} from "./native-mediasoup-utils.ts";
import { isPairedScreenAudio } from "./media-source-ownership.ts";
import type { NativeConsumerEntry } from "./types/native-mediasoup.ts";
import type { NativeMediasoupSfuSession } from "./native-mediasoup-session.ts";

function clearRetryTimer(
  session: NativeMediasoupSfuSession,
  producerId: string,
) {
  const timer = session.consumerRetryTimers.get(producerId);
  if (timer) clearTimeout(timer);
}

export function requestConsumer(
  session: NativeMediasoupSfuSession,
  producerId: string,
) {
  if (!producerId || producersHasId(session, producerId)) return false;
  if (!session.recvTransport || !session.device) {
    session.pendingConsumers.add(producerId);
    session.requestedConsumers.add(producerId);
    return false;
  }
  clearRetryTimer(session, producerId);
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

export function producersHasId(
  session: NativeMediasoupSfuSession,
  producerId: string,
) {
  return [...session.producers.values()].some(
    (entry) => entry.id === producerId,
  );
}

export async function createConsumer(
  session: NativeMediasoupSfuSession,
  data: Record<string, unknown>,
) {
  const producerId = String(data.producerId || "");
  const dataId = String(data.id || "");
  session.requestedConsumers.delete(producerId);
  session.pendingConsumers.delete(producerId);
  session.consumerRetryAttempts.delete(producerId);
  clearRetryTimer(session, producerId);
  session.consumerRetryTimers.delete(producerId);
  if (!session.recvTransport || session.consumers.has(dataId)) return null;
  const mediaRevision = session.mediaRevision;
  session.lastReceivedConsumerParams = data;
  const previousDirection = session.pendingNativeDirection;
  session.pendingNativeDirection = "recv";
  try {
    const result = await session.invoke("media_consume", {
      id: dataId,
      producerId,
      kind: String(data.kind || "audio"),
      rtpParameters: data.rtpParameters,
      appData: {
        userId: data.userId,
        source: data.source,
        ownerSource:
          typeof data.ownerSource === "string" ? data.ownerSource : null,
      },
    });
    const consumerId = String(result?.id || data.id || "");
    if (session.closed || mediaRevision !== session.mediaRevision) {
      await session
        .invoke("media_close_consumer", {
          consumerId,
        })
        .catch(() => {});
      return null;
    }
    const source = String(data.source || data.kind || "audio");
    const feedKey = nativeRemoteFeedKey(
      typeof data.userId === "string" || typeof data.userId === "number"
        ? data.userId
        : null,
      source,
      consumerId,
    );
    const previous = [...session.consumers.values()].find(
      (candidate) => candidate.key === feedKey,
    );
    if (previous) closeConsumer(session, previous);
    const entry = {
      key: feedKey,
      id: consumerId,
      consumerId,
      producerId: String(result?.producerId || producerId),
      userId:
        typeof data.userId === "string" || typeof data.userId === "number"
          ? data.userId
          : null,
      source,
      ownerSource:
        typeof data.ownerSource === "string" ? data.ownerSource : null,
      kind: String(result?.kind || data.kind || "audio"),
      track: null,
      stream: null,
      native: true,
      playback: String(data.kind) === "audio" ? "coreaudio" : "native-frame",
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
  session: NativeMediasoupSfuSession,
  userIdOrKey: string,
  sourceOrReceiving: string | boolean,
  receivingValue?: boolean,
): Promise<unknown> | false {
  if (typeof sourceOrReceiving === "boolean" && receivingValue === undefined) {
    const entry =
      session.consumers.get(userIdOrKey) ||
      session.remoteVideoFeeds.get(userIdOrKey) ||
      session.remoteAudioFeeds.get(userIdOrKey);
    return entry
      ? setRemoteReceiving(
          session,
          String(entry.userId),
          String(entry.source || ""),
          sourceOrReceiving,
        )
      : Promise.resolve(false);
  }
  const userId = userIdOrKey;
  const source = sourceOrReceiving;
  const receiving = Boolean(receivingValue);
  const operations: Array<Promise<unknown>> = [];
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

export function shouldReceive(
  session: NativeMediasoupSfuSession,
  userId: string | number | null | undefined,
  source: string,
  ownerSource: string | null = null,
) {
  const key = `${String(userId)}:${String(source)}`;
  if (session.remoteReceiving.has(key)) return session.remoteReceiving.get(key);
  return !isPairedScreenAudio({ source, ownerSource });
}

export function setConsumerVolume(
  session: NativeMediasoupSfuSession,
  userId: string | number,
  source: string,
  volume: number,
) {
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

export function sendParticipantVoiceState(
  session: NativeMediasoupSfuSession,
  state: { muted?: boolean; deafened?: boolean } = {},
) {
  return session.signaling?.send?.({
    type: "participant-voice-state",
    data: {
      muted: Boolean(state.muted),
      deafened: Boolean(state.deafened),
    },
  });
}

export async function setConsumerReceiving(
  session: NativeMediasoupSfuSession,
  entry: NativeConsumerEntry,
  receiving: boolean,
) {
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
      const result: unknown = await acknowledgement;
      if (
        result &&
        typeof result === "object" &&
        "consumerClosed" in result &&
        result.consumerClosed === true
      ) {
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

export function resolveConsumerControl(
  session: NativeMediasoupSfuSession,
  data: Record<string, unknown>,
  receiving: boolean,
) {
  const consumerId = String(data.consumerId || "");
  const requestId = String(data.requestId || "");
  const entry = session.consumers.get(consumerId);
  if (!entry) {
    session.pending.get(requestId)?.resolve({ ...data, consumerClosed: true });
    return;
  }
  session.pending.get(requestId)?.resolve({ ...data, receiving });
}

export function closeConsumerByProducer(
  session: NativeMediasoupSfuSession,
  producerId: string,
) {
  session.requestedConsumers.delete(producerId);
  session.pendingConsumers.delete(producerId);
  session.consumerRetryAttempts.delete(producerId);
  clearRetryTimer(session, producerId);
  session.consumerRetryTimers.delete(producerId);
  const entry = [...session.consumers.values()].find(
    (candidate) => candidate.producerId === producerId,
  );
  if (entry) closeConsumer(session, entry);
}

export function closeConsumer(
  session: NativeMediasoupSfuSession,
  entry: NativeConsumerEntry,
  { releaseNative = true }: { releaseNative?: boolean } = {},
) {
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
      .catch((error: unknown) =>
        session.onError?.(asError(error, "Native consumer close failed")),
      );
  session._emitState();
  return true;
}
