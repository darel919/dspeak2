import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { useAuthStore } from "./auth";

export const useStreamStore = defineStore("stream", () => {
  const streamActive = ref(false);
  const streamMetadata = ref(null);
  const streamerId = ref(null);
  const streamerName = ref("");
  const playHistory = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const config = useRuntimeConfig();

  function applyStreamStart(data) {
    streamActive.value = true;
    if (data.streamerId) streamerId.value = data.streamerId;
    if (data.streamerName) streamerName.value = data.streamerName;
  }

  function applyStreamMetadata(data) {
    streamMetadata.value = {
      title: data.title || "Unknown Track",
      artist: data.artist || "Unknown Artist",
      album: data.album || null,
      albumArtUrl: data.albumArtUrl || null,
    };
  }

  function applyStreamStop() {
    if (streamMetadata.value) {
      playHistory.value.unshift({
        ...streamMetadata.value,
        playedAt: new Date().toISOString(),
      });
      if (playHistory.value.length > 20) {
        playHistory.value = playHistory.value.slice(0, 20);
      }
    }
    streamActive.value = false;
    streamMetadata.value = null;
    streamerId.value = null;
    streamerName.value = "";
  }

  function applyPlaylogEntry(entry) {
    playHistory.value.unshift({
      title: entry.title || "Unknown Track",
      artist: entry.artist || "Unknown Artist",
      albumArtUrl: entry.albumArtUrl || null,
      playedAt: entry.playedAt || new Date().toISOString(),
    });
    if (playHistory.value.length > 20) {
      playHistory.value = playHistory.value.slice(0, 20);
    }
  }

  async function fetchStreamKey(channelId) {
    loading.value = true;
    error.value = null;
    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();
      if (!userData?.id) throw new Error("Not authenticated");
      const response = await fetch(
        `${config.public.apiPath}/stream/key/${channelId}`,
        { headers: { "Content-Type": "application/json" } },
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch stream key: ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function rotateStreamKey(channelId) {
    loading.value = true;
    error.value = null;
    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();
      if (!userData?.id) throw new Error("Not authenticated");
      const response = await fetch(
        `${config.public.apiPath}/stream/key/${channelId}/rotate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to rotate stream key: ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  function reset() {
    streamActive.value = false;
    streamMetadata.value = null;
    streamerId.value = null;
    streamerName.value = "";
    playHistory.value = [];
    loading.value = false;
    error.value = null;
  }

  return {
    streamActive,
    streamMetadata,
    streamerId,
    streamerName,
    playHistory,
    loading,
    error,
    applyStreamStart,
    applyStreamMetadata,
    applyStreamStop,
    applyPlaylogEntry,
    fetchStreamKey,
    rotateStreamKey,
    reset,
  };
});
