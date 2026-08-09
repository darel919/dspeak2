export function createHybridMediaSessionOperations({
  getSignaling,
  getTopologyController,
  getSessionTermination,
  getSessionLifecycle,
}) {
  return {
    send: (message) => getSignaling().send(message),
    ensureP2p: () => getTopologyController()?.ensureP2p() || null,
    ensureSfu: () => getTopologyController()?.ensureSfu() || null,
    handleProviderFailure: (data) =>
      getTopologyController()?.handleProviderFailure(data),
    handleP2pQualification: (data) =>
      getTopologyController()?.handleP2pQualification(data),
    queueTopology: (data) =>
      getTopologyController()?.queueTopology(data) || Promise.resolve(),
    reportSfuFailure: (reason) =>
      getTopologyController()?.reportSfuFailure(reason),
    failSession: (message) => getSessionTermination()?.failSession(message),
    disconnect: () => getSessionTermination()?.disconnect(),
    connect: (nextChannelId, options = {}) =>
      getSessionLifecycle()?.connect(nextChannelId, options),
    handleSignalingClose: (event, protocolRejected) =>
      getSessionLifecycle()?.handleSignalingClose(event, protocolRejected),
  };
}
