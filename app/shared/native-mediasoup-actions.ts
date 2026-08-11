import { closeConsumer } from "./native-mediasoup-consumers.ts";
import { receiveEventMatches, waitFor } from "./native-mediasoup-utils.ts";

export async function handleNativeAction(session, action) {
  if (!action || session.closed) return false;
  let params = action.params;
  if (typeof params === "string") params = JSON.parse(params);
  let state = action.state;
  if (typeof state === "string") {
    try {
      state = JSON.parse(state);
    } catch {}
  }
  const pointer = Number(action.transportPtr);
  if (action.kind === 1) {
    const direction =
      params?.direction ||
      session.transportPointers.get(pointer) ||
      session.pendingNativeDirection;
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
    const result: any = await acknowledgement;
    await session.invoke("media_complete_produce", {
      actionId: Number(action.actionId),
      producerId: result.id,
    });
    return true;
  }
  if (action.kind === 3 || action.kind === 4) {
    if (params?.event === "consumer-closed" && params.consumerId) {
      closeConsumer(
        session,
        session.consumers.get(params.consumerId) || {
          consumerId: params.consumerId,
          producerId: params.producerId,
        },
      );
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

export function handleReceiveEvent(session, event) {
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
  const consumerId = event?.id || payload.consumerId;
  const entry = session.consumers.get(consumerId);
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
  if (event.kind === 3) return closeConsumer(session, entry);
  return false;
}
