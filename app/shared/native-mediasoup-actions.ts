import { closeConsumer } from "./native-mediasoup-consumers.ts";
import { receiveEventMatches, waitFor } from "./native-mediasoup-utils.ts";
import type {
  NativeAction,
  NativeReceiveEvent,
} from "./types/native-mediasoup.ts";
import type { NativeDirection } from "./types/native-mediasoup-session.ts";
import type { NativeMediasoupSfuSession } from "./native-mediasoup-session.ts";

export async function handleNativeAction(
  session: NativeMediasoupSfuSession,
  action: NativeAction,
) {
  if (!action || session.closed) return false;
  let params: Record<string, unknown> =
    action.params && typeof action.params === "object" ? action.params : {};
  if (typeof action.params === "string")
    params = JSON.parse(action.params) as Record<string, unknown>;
  let state: Record<string, unknown> =
    action.state && typeof action.state === "object" ? action.state : {};
  if (typeof action.state === "string") {
    try {
      state = JSON.parse(action.state) as Record<string, unknown>;
    } catch {}
  }
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
    const result = (await acknowledgement) as Record<string, unknown>;
    await session.invoke("media_complete_produce", {
      actionId: Number(action.actionId),
      producerId: result.id,
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
  if (state) {
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
    if (!feed || !event.data) return false;
    session.localVideoFeeds.set(source, {
      ...feed,
      frame: {
        ...payload,
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
    if (entry.kind !== "video" || !event.data) return false;
    const feed = session.remoteVideoFeeds.get(entry.key);
    if (!feed) return false;
    feed.frame = {
      ...payload,
      data: event.data,
      eventId: event.eventId,
    };
    session.remoteVideoFeeds.set(entry.key, { ...feed });
    session._emitState();
    return true;
  }
  if (event.kind === 3 && entry) return closeConsumer(session, entry);
  return false;
}
