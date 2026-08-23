import { resolveMediaProviderIdentity } from "../media-provider-identity.ts";
import type {
  TopologyData,
  TopologyProviderActionsContext,
  TopologyProviderSocket,
} from "../types/topology-controller.ts";
import { isExternalRecord, isExternalString } from "../types/boundary.ts";

type ProviderEventData = {
  provider: string;
  providerId?: string;
  epoch: number;
  sourceRevision: number;
  reason: string;
  attemptId?: string;
};

function providerFailureReason<T>(value: T): string {
  if (value instanceof Error) return value.message;
  if (isExternalRecord(value) && isExternalString(value.reason))
    return value.reason;
  return "Provider transition failed";
}

export function createTopologyProviderActions({
  MediasoupProviderSocket,
  closeSfuSafely,
  ensureSfu,
  getActiveProvider,
  getHighestQueuedEpoch,
  getMediaCapabilities = () => null,
  getMessageHandler,
  getProviderSocket,
  getSelectedSfuProvider,
  getSfu,
  handleProviderFailure,
  replayCloudflarePublications,
  send,
  setProviderSocket,
  setSelectedSfuProvider,
  error,
  topologyState,
  waitForMediaTimeoutMs,
}: TopologyProviderActionsContext) {
  type ProviderTicketIdentity = {
    epoch: number;
    provider: string;
    providerId: string | null;
    sourceRevision: number;
    attemptId?: string;
  };
  type ProviderTicketReadyIdentity = ProviderTicketIdentity & {
    socket: TopologyProviderSocket;
  };
  type ProviderTicketWaiter = (ready: boolean) => void;

  const providerTicketWaiters = new Map<string, Set<ProviderTicketWaiter>>();
  let providerTicketAttempt = 0;
  let providerTicketConnecting: {
    attempt: number;
    identity: ProviderTicketIdentity;
  } | null = null;
  let providerTicketIdentity: ProviderTicketReadyIdentity | null = null;

  function providerTicketKey(identity: ProviderTicketIdentity) {
    const attempt = isExternalString(identity.attemptId)
      ? identity.attemptId
      : "";
    return `${identity.epoch}:${identity.provider}:${identity.providerId || ""}:${identity.sourceRevision}:${attempt}`;
  }

  function settleTicketWaiters(key: string, ready: boolean) {
    const waiters = providerTicketWaiters.get(key);
    if (!waiters) return;
    providerTicketWaiters.delete(key);
    for (const settle of waiters) settle(ready);
  }

  function isMediasoupProviderReady(identity: ProviderTicketIdentity) {
    const socket = getProviderSocket();
    if (providerTicketConnecting || !socket || !providerTicketIdentity)
      return false;
    return (
      providerTicketIdentity.socket === socket &&
      providerTicketIdentity.epoch === identity.epoch &&
      providerTicketIdentity.provider === "mediasoup" &&
      providerTicketIdentity.providerId === identity.providerId &&
      providerTicketIdentity.sourceRevision === identity.sourceRevision &&
      providerTicketIdentity.attemptId === identity.attemptId
    );
  }

  function waitForProviderTicket(
    epoch: number,
    provider: string,
    providerId: string | null = null,
    sourceRevision = 0,
    signal?: AbortSignal,
  ) {
    const identity = {
      epoch: Number(epoch),
      provider,
      providerId,
      sourceRevision: Number(sourceRevision) || 0,
    };
    const sfu = getSfu();
    const sfuReady =
      provider !== "mediasoup" &&
      sfu &&
      getSelectedSfuProvider() === provider &&
      (!providerId || sfu.providerId === providerId);
    const providerSocketReady =
      provider === "mediasoup" && isMediasoupProviderReady(identity);
    if (sfuReady || providerSocketReady) return Promise.resolve(true);
    if (signal?.aborted)
      return Promise.reject(
        signal.reason || new Error("Provider ticket wait superseded"),
      );
    const waiterKey = providerTicketKey(identity);
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        const waiters = providerTicketWaiters.get(waiterKey);
        if (!waiters) return;
        waiters.delete(settle);
        if (!waiters.size) providerTicketWaiters.delete(waiterKey);
      };
      const settle = (ready: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (ready) resolve(true);
        else reject(new Error("Provider ticket cancelled"));
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(signal?.reason || new Error("Provider ticket wait superseded"));
      };
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Provider ${provider} ticket timed out`));
      }, waitForMediaTimeoutMs());
      signal?.addEventListener("abort", onAbort, { once: true });
      const waiters = providerTicketWaiters.get(waiterKey) || new Set();
      waiters.add(settle);
      providerTicketWaiters.set(waiterKey, waiters);
    });
  }

  async function handleProviderTicket(data: TopologyData) {
    const { provider, providerId } = resolveMediaProviderIdentity(data);
    const epoch = Number(data?.epoch ?? data?.route?.epoch);
    const sourceRevision = Number(
      data?.sourceRevision ?? data?.route?.sourceRevision,
    );
    const resolvedSourceRevision = Number.isFinite(sourceRevision)
      ? sourceRevision
      : Number(topologyState.value.sourceRevision || 0);
    const routeRecord = isExternalRecord(data?.route) ? data.route : null;
    const attemptId = isExternalString(data.attemptId)
      ? data.attemptId
      : isExternalString(routeRecord?.attemptId)
        ? routeRecord.attemptId
        : undefined;
    if (
      !provider ||
      !Number.isSafeInteger(epoch) ||
      epoch < getHighestQueuedEpoch() ||
      resolvedSourceRevision < Number(topologyState.value.sourceRevision || 0)
    )
      return;
    const identity = {
      epoch,
      provider,
      providerId,
      sourceRevision: resolvedSourceRevision,
      attemptId,
    };
    const identityKey = providerTicketKey(identity);
    let socket: TopologyProviderSocket | null = null;
    let failureNotified = false;
    let attempt = 0;
    const isCurrentAttempt = () =>
      providerTicketConnecting?.attempt === attempt;
    const clearProviderSocket = () => {
      if (socket) {
        try {
          socket.close();
        } catch {}
        if (getProviderSocket() === socket) setProviderSocket(null);
      }
      if (providerTicketConnecting?.attempt === attempt) {
        providerTicketConnecting = null;
        providerTicketIdentity = null;
      }
    };
    const reportFailure = <T>(providerError: T) => {
      if (failureNotified) return;
      failureNotified = true;
      const failure: ProviderEventData = {
        provider,
        epoch,
        sourceRevision: resolvedSourceRevision,
        reason: providerFailureReason(providerError),
      };
      if (providerId) failure.providerId = providerId;
      if (attemptId) failure.attemptId = attemptId;
      send({
        type: "provider-failure",
        data: failure,
      });
    };
    const settleTicketWaiter = (ready: boolean) => {
      settleTicketWaiters(identityKey, ready);
    };
    const sendProviderReady = () => {
      if (
        send({
          type: "provider-ready",
          data: (() => {
            const ready: ProviderEventData = {
              provider,
              epoch,
              sourceRevision: resolvedSourceRevision,
              reason: "provider-ready",
            };
            if (providerId) ready.providerId = providerId;
            if (attemptId) ready.attemptId = attemptId;
            return ready;
          })(),
        }) === false
      )
        throw new Error("Media control signaling unavailable");
    };
    try {
      const activeSfu = getSfu();
      const sameActiveProvider =
        getActiveProvider() === "sfu" &&
        activeSfu &&
        !providerTicketConnecting &&
        getSelectedSfuProvider() === provider &&
        (!providerId || activeSfu.providerId === providerId) &&
        (provider !== "mediasoup" || isMediasoupProviderReady(identity));
      setSelectedSfuProvider(provider);
      if (sameActiveProvider) {
        providerTicketConnecting = null;
        sendProviderReady();
        settleTicketWaiter(true);
        return;
      }
      attempt = ++providerTicketAttempt;
      providerTicketConnecting = { attempt, identity };
      providerTicketIdentity = null;
      for (const key of providerTicketWaiters.keys()) {
        if (key !== identityKey) settleTicketWaiters(key, false);
      }
      await closeSfuSafely();
      if (!isCurrentAttempt()) {
        clearProviderSocket();
        return false;
      }
      if (provider === "cloudflare-realtime") {
        getProviderSocket()?.close();
        setProviderSocket(null);
        const session = ensureSfu();
        session.providerId = providerId;
        await session.initialize();
        if (!isCurrentAttempt()) {
          await closeSfuSafely();
          return false;
        }
        await replayCloudflarePublications(session);
        if (!isCurrentAttempt()) {
          await closeSfuSafely();
          return false;
        }
        providerTicketConnecting = null;
        sendProviderReady();
        settleTicketWaiter(true);
        return;
      }
      if (
        provider !== "mediasoup" ||
        !isExternalString(data.signalingUrl) ||
        !isExternalString(data.ticket)
      )
        throw new Error("Media provider ticket is incomplete");
      getProviderSocket()?.close();
      setProviderSocket(null);
      socket = new MediasoupProviderSocket({
        onMessage: (type: string, payload: Record<string, unknown>) => {
          if (!isCurrentAttempt() || getProviderSocket() !== socket) return;
          if (type === "provider-draining") {
            const failure: ProviderEventData = {
              provider,
              epoch,
              sourceRevision: resolvedSourceRevision,
              reason: isExternalString(payload?.reason)
                ? payload.reason
                : "provider-draining",
            };
            if (providerId) failure.providerId = providerId;
            socket?.close();
            setProviderSocket(null);
            handleProviderFailure(failure);
            reportFailure(failure);
            return;
          }
          return getMessageHandler(type)?.(payload || {});
        },
        onFailure: <T>(providerError: T) => {
          if (!isCurrentAttempt() || getProviderSocket() !== socket) return;
          clearProviderSocket();
          error.value =
            providerError instanceof Error
              ? providerError.message
              : String(providerError);
          reportFailure(providerError);
        },
      });
      setProviderSocket(socket);
      await socket.connect({
        signalingUrl: data.signalingUrl,
        ticket: data.ticket,
        mediaCapabilities: getMediaCapabilities(),
        capabilityProtocol: "video-codec-matrix-v1",
      });
      if (!isCurrentAttempt() || getProviderSocket() !== socket) {
        socket.close();
        return false;
      }
      providerTicketConnecting = null;
      providerTicketIdentity = { ...identity, socket };
      sendProviderReady();
      settleTicketWaiter(true);
    } catch (providerError) {
      if (!isCurrentAttempt()) {
        try {
          socket?.close();
        } catch {}
        return false;
      }
      clearProviderSocket();
      settleTicketWaiter(false);
      reportFailure(providerError);
      error.value =
        providerError instanceof Error
          ? providerError.message
          : String(providerError);
      return false;
    }
  }

  function reset() {
    providerTicketAttempt += 1;
    for (const key of providerTicketWaiters.keys())
      settleTicketWaiters(key, false);
    providerTicketWaiters.clear();
    providerTicketConnecting = null;
    providerTicketIdentity = null;
  }

  return {
    handleProviderTicket,
    reset,
    waitForProviderTicket,
  };
}
