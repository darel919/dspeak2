import { resolveMediaProviderIdentity } from "../media-provider-identity.ts";
import type {
  TopologyData,
  TopologyProviderActionsContext,
  TopologyProviderSocket,
} from "../types/topology-controller.ts";

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
  const providerTicketWaiters = new Map<number, (ready: boolean) => void>();

  function waitForProviderTicket(
    epoch: number,
    provider: string,
    providerId: string | null = null,
  ) {
    const sfu = getSfu();
    if (
      sfu &&
      getSelectedSfuProvider() === provider &&
      (!providerId || sfu.providerId === providerId)
    )
      return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        providerTicketWaiters.delete(Number(epoch));
        reject(new Error(`Provider ${provider} ticket timed out`));
      }, waitForMediaTimeoutMs());
      providerTicketWaiters.set(Number(epoch), (ready: boolean) => {
        clearTimeout(timeout);
        if (ready) resolve(true);
        else reject(new Error("Provider ticket cancelled"));
      });
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
    if (
      !provider ||
      !Number.isSafeInteger(epoch) ||
      epoch < getHighestQueuedEpoch() ||
      resolvedSourceRevision < Number(topologyState.value.sourceRevision || 0)
    )
      return;
    let socket: TopologyProviderSocket | null = null;
    let failureNotified = false;
    const clearProviderSocket = () => {
      if (!socket || getProviderSocket() !== socket) return;
      try {
        socket.close();
      } catch {}
      setProviderSocket(null);
    };
    const reportFailure = (providerError: unknown) => {
      if (failureNotified) return;
      failureNotified = true;
      send({
        type: "provider-failure",
        data: {
          provider,
          ...(providerId ? { providerId } : {}),
          epoch,
          sourceRevision: resolvedSourceRevision,
          reason:
            providerError instanceof Error
              ? providerError.message
              : providerError &&
                  typeof providerError === "object" &&
                  "reason" in providerError
                ? String(providerError.reason)
                : "Provider transition failed",
        },
      });
    };
    const settleTicketWaiter = (ready: boolean) => {
      providerTicketWaiters.get(epoch)?.(ready);
      providerTicketWaiters.delete(epoch);
    };
    const sendProviderReady = () => {
      if (
        send({
          type: "provider-ready",
          data: {
            provider,
            ...(providerId ? { providerId } : {}),
            epoch,
            sourceRevision: resolvedSourceRevision,
          },
        }) === false
      )
        throw new Error("Media control signaling unavailable");
    };
    try {
      const activeSfu = getSfu();
      const sameActiveProvider =
        getActiveProvider() === "sfu" &&
        activeSfu &&
        getSelectedSfuProvider() === provider &&
        (!providerId || activeSfu.providerId === providerId);
      setSelectedSfuProvider(provider);
      if (sameActiveProvider) {
        sendProviderReady();
        settleTicketWaiter(true);
        return;
      }
      await closeSfuSafely();
      if (provider === "cloudflare-realtime") {
        getProviderSocket()?.close();
        setProviderSocket(null);
        const session = ensureSfu();
        session.providerId = providerId;
        await session.initialize();
        await replayCloudflarePublications(session);
        sendProviderReady();
        settleTicketWaiter(true);
        return;
      }
      if (
        provider !== "mediasoup" ||
        typeof data.signalingUrl !== "string" ||
        typeof data.ticket !== "string"
      )
        throw new Error("Media provider ticket is incomplete");
      getProviderSocket()?.close();
      socket = new MediasoupProviderSocket({
        onMessage: (type: string, payload: Record<string, unknown>) => {
          if (type === "provider-draining") {
            const failure = {
              provider,
              ...(providerId ? { providerId } : {}),
              epoch,
              sourceRevision: resolvedSourceRevision,
              reason: payload?.reason || "provider-draining",
            };
            socket?.close();
            setProviderSocket(null);
            handleProviderFailure(failure);
            reportFailure(failure);
            return;
          }
          return getMessageHandler(type)?.(payload || {});
        },
        onFailure: (providerError: unknown) => {
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
      sendProviderReady();
      settleTicketWaiter(true);
    } catch (providerError: unknown) {
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
    for (const resolve of providerTicketWaiters.values()) resolve(false);
    providerTicketWaiters.clear();
  }

  return {
    handleProviderTicket,
    reset,
    waitForProviderTicket,
  };
}
