import { useStreamStore } from "../stores/stream";

export function useStreamRelay() {
  function handleStreamEvent(event) {
    if (!event?.type) return;
    const streamStore = useStreamStore();
    switch (event.type) {
      case "stream:start":
        streamStore.applyStreamStart(event.data);
        break;
      case "stream:metadata":
        streamStore.applyStreamMetadata(event.data);
        break;
      case "stream:stop":
        streamStore.applyStreamStop();
        break;
      case "stream:playlog":
        if (event.data?.history) {
          for (const entry of event.data.history) {
            streamStore.applyPlaylogEntry(entry);
          }
        }
        break;
    }
  }

  function resetStreamState() {
    const streamStore = useStreamStore();
    streamStore.reset();
  }

  return {
    handleStreamEvent,
    resetStreamState,
    streamActive: computed(() => {
      const streamStore = useStreamStore();
      return streamStore.streamActive;
    }),
    streamMetadata: computed(() => {
      const streamStore = useStreamStore();
      return streamStore.streamMetadata;
    }),
    streamerName: computed(() => {
      const streamStore = useStreamStore();
      return streamStore.streamerName;
    }),
    playHistory: computed(() => {
      const streamStore = useStreamStore();
      return streamStore.playHistory;
    }),
  };
}
