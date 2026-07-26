export function initialMediaTopologyState() {
  return {
    mode: "idle",
    epoch: 0,
    reason: "waiting-for-peer",
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
    assert(generation) {
      if (generation !== current)
        throw new Error("Media signaling generation retired");
    },
  };
}
