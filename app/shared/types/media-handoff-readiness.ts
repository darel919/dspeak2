import type { Ref } from "vue";
import type { OwnedErrorValue } from "./shared-utilities.ts";
import type {
  TopologyData,
  TopologyP2pMesh,
  TopologySfuSession,
  TopologySourceEntry,
  TopologyState,
} from "./topology-controller.ts";

export interface MediaHandoffReadinessContext {
  getLatestTopologyKey: () => string;
  getLocalPeerId: () => string | null;
  getP2pMesh: () => TopologyP2pMesh | null;
  getSfu: () =>
    | (TopologySfuSession & {
        shouldReceive?: (
          userId: string | number | null | undefined,
          source: string,
        ) => boolean;
      })
    | null;
  handoff: import("./topology-controller.ts").TopologyHandoff;
  localSources: Map<string, TopologySourceEntry>;
  pollIntervalMs: number;
  provider: "p2p" | "sfu";
  signal?: AbortSignal;
  timeoutMs: number;
  topology: TopologyData;
  topologyEventKey: (data: TopologyData) => string;
  topologyState: Ref<TopologyState>;
}

export interface InitialMediaTopologyContext {
  isReady: () => boolean;
  setWaiter: (waiter: ((error?: OwnedErrorValue) => void) | null) => void;
  timeoutMs: number;
}
