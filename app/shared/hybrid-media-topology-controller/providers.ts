export function createTopologyProviderActions({
  MediasoupProviderSocket,
  closeSfuSafely,
  ensureSfu,
  getActiveProvider,
  getHighestQueuedEpoch,
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
}) {
  const providerTicketWaiters = new Map();

  function waitForProviderTicket(epoch, provider) {
    if (getSfu() && getSelectedSfuProvider() === provider)
      return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        providerTicketWaiters.delete(Number(epoch));
        reject(new Error(`Provider ${provider} ticket timed out`));
      }, waitForMediaTimeoutMs());
      providerTicketWaiters.set(Number(epoch), (ready) => {
        clearTimeout(timeout);
        if (ready) resolve(true);
        else reject(new Error("Provider ticket cancelled"));
      });
    });
  }

  async function handleProviderTicket(data) {
    const epoch = Number(data?.epoch ?? data?.route?.epoch);
    const sourceRevision = Number(
      data?.sourceRevision ?? data?.route?.sourceRevision,
    );
    const resolvedSourceRevision = Number.isFinite(sourceRevision)
      ? sourceRevision
      : Number(topologyState.value.sourceRevision || 0);
    if (
      !data?.provider ||
      !Number.isSafeInteger(epoch) ||
      epoch < getHighestQueuedEpoch() ||
      resolvedSourceRevision < Number(topologyState.value.sourceRevision || 0)
    )
      return;
    let socket = null;
    let failureNotified = false;
    const clearProviderSocket = () => {
      if (!socket || getProviderSocket() !== socket) return;
      try {
        socket.close();
      } catch {}
      setProviderSocket(null);
    };
    const reportFailure = (providerError) => {
      if (failureNotified) return;
      failureNotified = true;
      send({
        type: "provider-failure",
        data: {
          provider: data.provider,
          epoch,
          sourceRevision: resolvedSourceRevision,
          reason:
            providerError?.message ||
            providerError?.reason ||
            "Provider transition failed",
        },
      });
    };
    const settleTicketWaiter = (ready) => {
      providerTicketWaiters.get(epoch)?.(ready);
      providerTicketWaiters.delete(epoch);
    };
    const sendProviderReady = () => {
      if (
        send({
          type: "provider-ready",
          data: {
            provider: data.provider,
            epoch,
            sourceRevision: resolvedSourceRevision,
          },
        }) === false
      )
        throw new Error("Media control signaling unavailable");
    };
    try {
      const sameActiveProvider =
        getActiveProvider() === "sfu" &&
        getSfu() &&
        getSelectedSfuProvider() === data.provider;
      setSelectedSfuProvider(data.provider);
      if (sameActiveProvider) {
        sendProviderReady();
        settleTicketWaiter(true);
        return;
      }
      await closeSfuSafely();
      if (data.provider === "cloudflare-realtime") {
        getProviderSocket()?.close();
        setProviderSocket(null);
        const session = ensureSfu();
        await session.initialize();
        await replayCloudflarePublications(session);
        sendProviderReady();
        settleTicketWaiter(true);
        return;
      }
      if (data.provider !== "mediasoup" || !data.signalingUrl)
        throw new Error("Media provider ticket is incomplete");
      getProviderSocket()?.close();
      socket = new MediasoupProviderSocket({
        onMessage: (type, payload) => {
          if (type === "provider-draining") {
            const failure = {
              provider: data.provider,
              epoch,
              sourceRevision: resolvedSourceRevision,
              reason: payload?.reason || "provider-draining",
            };
            socket.close();
            setProviderSocket(null);
            handleProviderFailure(failure);
            reportFailure(failure);
            return;
          }
          return getMessageHandler(type)?.(payload || {});
        },
        onFailure: (providerError) => {
          clearProviderSocket();
          error.value = providerError;
          reportFailure(providerError);
        },
      });
      setProviderSocket(socket);
      await socket.connect(data);
      sendProviderReady();
      settleTicketWaiter(true);
    } catch (providerError) {
      clearProviderSocket();
      settleTicketWaiter(false);
      reportFailure(providerError);
      error.value = providerError;
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
