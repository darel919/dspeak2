export function initialMediaTopologyState(reason = "waiting-for-peer") {
  return {
    mode: "idle",
    epoch: 0,
    reason,
    peers: [],
    activatedAt: null,
  };
}

export function createMediaGeneration() {
  let current = 0;
  return {
    capture: () => current,
    retire: () => {
      current += 1;
      return current;
    },
    assert(generation: number) {
      if (generation !== current)
        throw new Error("Media signaling generation retired");
    },
  };
}
