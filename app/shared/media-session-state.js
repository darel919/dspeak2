export function initialMediaTopologyState() {
  return {
    mode: "idle",
    epoch: 0,
    reason: "waiting-for-peer",
    peers: [],
    activatedAt: null,
  };
}
