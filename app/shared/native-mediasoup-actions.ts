import {
  closeConsumer,
  commitVideoMigration,
  NATIVE_CODEC_MIGRATION_REQUIRED_FRAMES,
  rollbackVideoMigration,
} from "./native-mediasoup-consumers.ts";
import { receiveEventMatches, waitFor } from "./native-mediasoup-utils.ts";
import {
  candidateFrameCount,
  hasAdvancingTimestamp,
  isPresentableVideoFrame,
} from "./video-codec-migration.ts";
import type {
  NativeAction,
  NativeReceiveEvent,
} from "./types/native-mediasoup.ts";
import type { NativeDirection } from "./types/native-mediasoup-session.ts";
import type { NativeMediasoupSfuSession } from "./native-mediasoup-session.ts";
import {
  isExternalRecord,
  isExternalString,
  type ExternalValue,
} from "./types/boundary.ts";

type NativeReceiveFrame = {
  data: string;
  eventId?: number | string;
  timestamp?: number;
  [key: string]: unknown;
};

function actionValue<T>(value: T): ExternalValue | null {
  if (isExternalRecord(value)) return value;
  if (!isExternalString(value)) return null;
  try {
    const parsed = JSON.parse(value);
    return isExternalRecord(parsed) || isExternalString(parsed) ? parsed : null;
  } catch {
    return value;
  }
}

function actionRecord<T>(value: T): Record<string, unknown> {
  const parsed = actionValue(value);
  return isExternalRecord(parsed) ? parsed : {};
}

function nativeReceiveFrame(
  payload: Record<string, unknown>,
  data: string,
  eventId: number | string | undefined,
  timestamp: number,
): NativeReceiveFrame {
  const frame = Object.assign({}, payload, { data, eventId });
  if (Number.isFinite(timestamp)) Object.assign(frame, { timestamp });
  return frame;
}

export async function handleNativeAction(
  session: NativeMediasoupSfuSession,
  action: NativeAction,
) {
  if (!action || session.closed) return false;
  const params = actionRecord(action.params);
  const state = actionValue(action.state);
  const pointer = Number(action.transportPtr);
  if (action.kind === 1) {
    const directionValue =
      params.direction ||
      session.transportPointers.get(pointer) ||
      session.pendingNativeDirection;
    const direction: NativeDirection | undefined =
      directionValue === "send" || directionValue === "recv"
        ? directionValue
        : undefined;
    const transport =
      direction === "recv" ? session.recvTransport : session.sendTransport;
    if (!direction || !transport)
      throw new Error("Native transport direction is unknown");
    session.transportPointers.set(pointer, direction);
    const requestId = session.requestId("connect");
    const acknowledgement = waitFor(
      session.pending,
      requestId,
      session.requestTimeoutMs,
      `SFU ${direction} transport connection`,
    );
    session.sendOrThrow(
      {
        type: "connect-transport",
        data: {
          requestId,
          transportId: transport.id,
          dtlsParameters: Object.fromEntries(
            Object.entries(params || {}).filter(([key]) => key !== "direction"),
          ),
        },
      },
      `SFU ${direction} transport connection`,
    );
    await acknowledgement;
    await session.invoke("media_complete_connect", { transportPtr: pointer });
    return true;
  }
  if (action.kind === 2) {
    const direction = session.transportPointers.get(pointer) || "send";
    const transport =
      direction === "recv" ? session.recvTransport : session.sendTransport;
    if (!transport) throw new Error("Native send transport is unavailable");
    session.transportPointers.set(pointer, direction);
    const requestId = session.requestId("produce");
    const acknowledgement = waitFor(
      session.pendingProduce,
      requestId,
      session.requestTimeoutMs,
      "SFU produce",
    );
    session.sendOrThrow(
      {
        type: "produce",
        data: {
          requestId,
          transportId: transport.id,
          kind: params?.kind,
          rtpParameters: params?.rtpParameters,
          appData: params?.appData,
        },
      },
      "SFU producer publication",
    );
    const result = await acknowledgement;
    const producerId = isExternalRecord(result) ? result.id : undefined;
    await session.invoke("media_complete_produce", {
      actionId: Number(action.actionId),
      producerId,
    });
    return true;
  }
  if (action.kind === 3 || action.kind === 4) {
    if (params?.event === "consumer-closed" && params.consumerId) {
      const consumerId = String(params.consumerId);
      const entry = session.consumers.get(consumerId) || {
        consumerId,
        key: consumerId,
        producerId: String(params.producerId || ""),
        kind: "audio",
        source: "audio",
      };
      closeConsumer(session, entry);
    }
    return true;
  }
  if (state !== null) {
    const direction = session.transportPointers.get(pointer);
    if (direction) session._handleTransportState({ direction, state });
    return true;
  }
  return false;
}

export function handleReceiveEvent(
  session: NativeMediasoupSfuSession,
  event: NativeReceiveEvent,
) {
  const payload = event?.payload || {};
  if (event?.kind === 5) {
    const source = String(payload.source || event.id || "");
    let feed = session.localVideoFeeds.get(source);
    if (!feed && session.sources.get(source)?.kind === "video") {
      feed = {
        source,
        producerId: `local:${source}`,
        native: true,
        frame: null,
      };
      session.localVideoFeeds.set(source, feed);
    }
    if (!feed) return false;
    if (!isExternalString(event.data) || !event.data) return false;
    session.localVideoFeeds.set(source, {
      ...feed,
      frame: {
        ...payload,
        source,
        data: event.data,
        eventId: event.eventId,
      },
    });
    session._emitState();
    return true;
  }
  const consumerId = String(event?.id || payload.consumerId || "");
  if (!consumerId) return false;
  const entry = session.consumers.get(consumerId);
  if (!entry) return false;
  if (!receiveEventMatches(entry, { ...payload, consumerId })) return false;
  if (event.kind === 1) return true;
  if (event.kind === 2) {
    if (entry.kind !== "video") return false;
    if (!isExternalString(event.data) || !event.data) return false;
    const timestamp = Number(payload.timestamp ?? payload.timestampMs);
    const frame = nativeReceiveFrame(
      payload,
      event.data,
      event.eventId,
      timestamp,
    );
    if (!isPresentableVideoFrame(frame)) return false;
    const previousTimestamp = entry.lastFrameTimestamp;
    const nextTimestamp = Number(payload.timestamp ?? payload.timestampMs);
    entry.presentableFrames = candidateFrameCount(
      entry.presentableFrames || 0,
      previousTimestamp,
      frame,
    );
    if (Number.isFinite(nextTimestamp))
      entry.lastFrameTimestamp = nextTimestamp;
    entry.lastFrameAt = Date.now();
    entry.frame = frame;
    if (
      entry.visible === false &&
      entry.migrationState === "warming-receivers"
    ) {
      if (
        entry.presentableFrames >= NATIVE_CODEC_MIGRATION_REQUIRED_FRAMES &&
        hasAdvancingTimestamp(previousTimestamp, nextTimestamp)
      )
        commitVideoMigration(session, entry);
      session._emitState();
      return true;
    }
    if (entry.visible === false || entry.superseded === true) return true;
    const feed = session.remoteVideoFeeds.get(entry.key);
    if (!feed) return false;
    session.remoteVideoFeeds.set(entry.key, {
      ...feed,
      ...entry,
      frame,
    });
    session._emitState();
    return true;
  }
  if (
    event.kind === 3 &&
    entry?.kind === "video" &&
    entry.visible !== false &&
    entry.migrationState === "committing"
  )
    return (
      rollbackVideoMigration(session, entry, "candidate-ended") ||
      closeConsumer(session, entry)
    );
  if (event.kind === 3 && entry) return closeConsumer(session, entry);
  return false;
}
