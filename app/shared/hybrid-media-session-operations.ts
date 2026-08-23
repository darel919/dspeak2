import type { HybridSessionOperationsContext } from "./types/hybrid-media-session.ts";
import type { SignalingMessage } from "./types/media-signaling.ts";
import type { TopologyData } from "./types/topology-controller.ts";
import type { OwnedErrorValue } from "./types/shared-utilities.ts";

export function createHybridMediaSessionOperations({
  getSignaling,
  getTopologyController,
  getSessionTermination,
  getSessionLifecycle,
}: HybridSessionOperationsContext) {
  return {
    send: (message: SignalingMessage) => getSignaling().send(message),
    ensureP2p: () => getTopologyController()?.ensureP2p() || null,
    ensureSfu: () => getTopologyController()?.ensureSfu() || null,
    handleProviderFailure: (data?: Record<string, unknown>) =>
      getTopologyController()?.handleProviderFailure(data),
    handleP2pQualification: (data?: Record<string, unknown>) =>
      getTopologyController()?.handleP2pQualification(data),
    queueTopology: (data: TopologyData) =>
      getTopologyController()?.queueTopology(data) || Promise.resolve(),
    reportSfuFailure: (reason: string) =>
      getTopologyController()?.reportSfuFailure(reason),
    failSession: (message: OwnedErrorValue) =>
      getSessionTermination()?.failSession(message),
    disconnect: () =>
      getSessionTermination()?.disconnect() ?? Promise.resolve(),
    connect: (nextChannelId: string, options: { roomId?: string } = {}) =>
      getSessionLifecycle()?.connect(nextChannelId, options),
    handleSignalingClose: (event: CloseEvent, protocolRejected: boolean) =>
      getSessionLifecycle()?.handleSignalingClose(event, protocolRejected),
  };
}
