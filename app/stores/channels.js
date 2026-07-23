import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { useAuthStore } from "./auth";

export const useChannelsStore = defineStore("channels", () => {
  const channels = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const currentChannelId = ref(null);
  const voiceProfiles = ref(new Map());
  const loadedRoomId = ref(null);
  const roomChannels = new Map();
  const pendingRoomRequests = new Map();
  let voicePresenceSocket = null;
  let voicePresenceRoomId = null;
  let voicePresenceReconnectTimer = null;
  let voicePresenceReconnectAttempt = 0;
  let voicePresenceHeartbeatTimer = null;
  let voicePresenceIntentionalClose = false;
  const config = useRuntimeConfig();

  async function fetchChannels(roomId, options = {}) {
    if (!roomId) {
      throw new Error("Room ID is required");
    }

    const normalizedRoomId = String(roomId);
    const activate = options.activate !== false;
    const force = options.force === true;
    if (!force && roomChannels.has(normalizedRoomId)) {
      const cachedChannels = roomChannels.get(normalizedRoomId);
      if (activate) activateRoomChannels(normalizedRoomId, cachedChannels);
      return cachedChannels;
    }
    if (pendingRoomRequests.has(normalizedRoomId)) {
      const pendingChannels = await pendingRoomRequests.get(normalizedRoomId);
      if (activate) activateRoomChannels(normalizedRoomId, pendingChannels);
      return pendingChannels;
    }

    const request = fetchChannelsFromServer(normalizedRoomId);
    pendingRoomRequests.set(normalizedRoomId, request);
    try {
      const nextChannels = await request;
      if (activate) activateRoomChannels(normalizedRoomId, nextChannels);
      return nextChannels;
    } finally {
      if (pendingRoomRequests.get(normalizedRoomId) === request)
        pendingRoomRequests.delete(normalizedRoomId);
    }
  }

  function activateRoomChannels(roomId, nextChannels) {
    channels.value = nextChannels;
    loadedRoomId.value = String(roomId);
  }

  async function fetchChannelsFromServer(roomId) {
    loading.value = true;
    error.value = null;

    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();

      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }

      const apiPath = config.public.apiPath;
      const response = await fetch(`${apiPath}/channel/?roomId=${roomId}`, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch channels: ${response.status}`);
      }

      const data = await response.json();
      const nextChannels = Array.isArray(data) ? data : [];
      roomChannels.set(String(roomId), nextChannels);
      console.debug("[ChannelsStore] Fetched channels:", nextChannels);

      return nextChannels;
    } catch (err) {
      error.value = err.message;
      console.error("[ChannelsStore] Error fetching channels:", err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function createChannel(roomId, channelData) {
    if (!roomId) {
      throw new Error("Room ID is required");
    }

    if (!channelData.name || !channelData.name.trim()) {
      throw new Error("Channel name is required");
    }

    loading.value = true;
    error.value = null;

    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();

      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }

      const apiPath = config.public.apiPath;
      const response = await fetch(`${apiPath}/channel/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomId,
          name: channelData.name.trim(),
          desc: channelData.desc || "",
          isMedia: channelData.isMedia || false,
          audio_bitrate: channelData.audio_bitrate || null,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to create channel: ${response.status} ${errorText}`,
        );
      }

      const newChannel = await response.json();
      console.debug("[ChannelsStore] Created channel:", newChannel);

      await fetchChannels(roomId, { force: true });

      return newChannel;
    } catch (err) {
      error.value = err.message;
      console.error("[ChannelsStore] Error creating channel:", err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function editChannel(channelId, channelData) {
    if (!channelId) {
      throw new Error("Channel ID is required");
    }

    loading.value = true;
    error.value = null;

    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();

      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }

      const apiPath = config.public.apiPath;
      const response = await fetch(`${apiPath}/channel/`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channelId,
          name: channelData.name?.trim(),
          desc: channelData.desc,
          audio_bitrate: channelData.audio_bitrate,
          mediaPolicy: channelData.mediaPolicy,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to edit channel: ${response.status} ${errorText}`,
        );
      }

      console.debug("[ChannelsStore] Edited channel:", channelId);

      const channelIndex = channels.value.findIndex((c) => c.id === channelId);
      if (channelIndex !== -1) {
        channels.value[channelIndex] = {
          ...channels.value[channelIndex],
          ...channelData,
        };
        channels.value = [...channels.value];
        if (loadedRoomId.value)
          roomChannels.set(loadedRoomId.value, channels.value);
      }

      return true;
    } catch (err) {
      error.value = err.message;
      console.error("[ChannelsStore] Error editing channel:", err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function deleteChannel(channelId) {
    if (!channelId) {
      throw new Error("Channel ID is required");
    }

    loading.value = true;
    error.value = null;

    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();

      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }

      const apiPath = config.public.apiPath;
      const response = await fetch(`${apiPath}/channel/`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channelId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to delete channel: ${response.status} ${errorText}`,
        );
      }

      console.debug("[ChannelsStore] Deleted channel:", channelId);

      channels.value = channels.value.filter((c) => c.id !== channelId);
      if (loadedRoomId.value)
        roomChannels.set(loadedRoomId.value, channels.value);

      if (currentChannelId.value === channelId) {
        currentChannelId.value = null;
      }

      return true;
    } catch (err) {
      error.value = err.message;
      console.error("[ChannelsStore] Error deleting channel:", err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function joinChannel(channelId) {
    if (!channelId) {
      throw new Error("Channel ID is required");
    }

    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();

      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }

      const apiPath = config.public.apiPath;
      const response = await fetch(`${apiPath}/channel/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channelId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to join channel: ${response.status} ${errorText}`,
        );
      }

      console.debug("[ChannelsStore] Joined channel:", channelId);

      const channelIndex = channels.value.findIndex((c) => c.id === channelId);
      if (channelIndex !== -1) {
        const channel = channels.value[channelIndex];
        if (!channel.inRoom.includes(userData.id)) {
          channel.inRoom.push(userData.id);
        }
      }

      return true;
    } catch (err) {
      console.error("[ChannelsStore] Error joining channel:", err);
      throw err;
    }
  }

  async function leaveChannel(channelId) {
    if (!channelId) {
      throw new Error("Channel ID is required");
    }

    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();

      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }

      const apiPath = config.public.apiPath;
      const response = await fetch(`${apiPath}/channel/leave`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channelId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to leave channel: ${response.status} ${errorText}`,
        );
      }

      console.debug("[ChannelsStore] Left channel:", channelId);

      const channelIndex = channels.value.findIndex((c) => c.id === channelId);
      if (channelIndex !== -1) {
        const channel = channels.value[channelIndex];
        channel.inRoom = channel.inRoom.filter(
          (userId) => userId !== userData.id,
        );
      }

      return true;
    } catch (err) {
      console.error("[ChannelsStore] Error leaving channel:", err);
      throw err;
    }
  }

  async function moderateVoiceParticipant(
    channelId,
    targetUserId,
    targetChannelId = null,
  ) {
    const authStore = useAuthStore();
    const userData = authStore.getUserData();
    if (!userData?.id) throw new Error("User not authenticated");
    const response = await fetch(
      `${config.public.apiPath}/channel/moderate-voice`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channelId,
          targetUserId,
          targetChannelId,
        }),
      },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(
        payload?.statusMessage ||
          payload?.message ||
          "Unable to moderate this voice participant",
      );
    }
    return response.json();
  }

  async function getChannelDetails(channelId) {
    if (!channelId) {
      throw new Error("Channel ID is required");
    }

    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();

      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }

      const apiPath = config.public.apiPath;
      const response = await fetch(
        `${apiPath}/channel/details?id=${channelId}`,
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch channel details: ${response.status}`);
      }

      const channelDetails = await response.json();
      console.debug("[ChannelsStore] Fetched channel details:", channelDetails);

      return channelDetails;
    } catch (err) {
      console.error("[ChannelsStore] Error fetching channel details:", err);
      throw err;
    }
  }

  async function getUnreadCounts() {
    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();

      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }

      const apiPath = config.public.apiPath;
      const response = await fetch(`${apiPath}/chat/unread`, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch unread counts: ${response.status}`);
      }

      const unreadCounts = await response.json();
      console.debug("[ChannelsStore] Fetched unread counts:", unreadCounts);

      return unreadCounts;
    } catch (err) {
      console.error("[ChannelsStore] Error fetching unread counts:", err);
      throw err;
    }
  }

  function getChannelById(channelId) {
    return channels.value.find((c) => c.id === channelId);
  }

  function getTextChannels() {
    return channels.value.filter((c) => !c.isMedia);
  }

  function getMediaChannels() {
    return channels.value.filter((c) => c.isMedia);
  }

  function clearChannels() {
    disconnectVoicePresence();
    channels.value = [];
    loadedRoomId.value = null;
    roomChannels.clear();
    currentChannelId.value = null;
    error.value = null;
  }

  function applyVoicePresence(snapshot) {
    if (!snapshot?.channelId || !Array.isArray(snapshot.inRoom)) return false;
    const channel = channels.value.find(
      (item) => String(item.id) === String(snapshot.channelId),
    );
    if (!channel) return false;
    channel.inRoom = [...new Set(snapshot.inRoom.map(String))];
    const participantStates = Array.isArray(snapshot.participantStates)
      ? snapshot.participantStates
      : [];
    channel.participantStates = Object.fromEntries(
      participantStates
        .filter((state) => state?.userId)
        .map((state) => [String(state.userId), { ...state }]),
    );
    for (const profile of snapshot.profiles || []) {
      if (profile?.id)
        voiceProfiles.value.set(String(profile.id), {
          ...(voiceProfiles.value.get(String(profile.id)) || {}),
          ...profile,
          id: String(profile.id),
        });
    }
    voiceProfiles.value = new Map(voiceProfiles.value);
    channels.value = [...channels.value];
    return true;
  }

  function disconnectVoicePresence() {
    voicePresenceIntentionalClose = true;
    if (voicePresenceReconnectTimer) clearTimeout(voicePresenceReconnectTimer);
    if (voicePresenceHeartbeatTimer) clearInterval(voicePresenceHeartbeatTimer);
    voicePresenceReconnectTimer = null;
    voicePresenceHeartbeatTimer = null;
    const socket = voicePresenceSocket;
    voicePresenceSocket = null;
    voicePresenceRoomId = null;
    voicePresenceReconnectAttempt = 0;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000);
  }

  function connectVoicePresence(roomId) {
    if (!import.meta.client || !roomId) return;
    const normalizedRoomId = String(roomId);
    if (
      voicePresenceRoomId === normalizedRoomId &&
      voicePresenceSocket &&
      voicePresenceSocket.readyState <= WebSocket.OPEN
    )
      return;
    if (voicePresenceRoomId && voicePresenceRoomId !== normalizedRoomId)
      disconnectVoicePresence();
    const userId = useAuthStore().getUserData()?.id;
    if (!userId) return;
    voicePresenceIntentionalClose = false;
    voicePresenceRoomId = normalizedRoomId;
    const base = config.public.apiPath
      .replace(/^http/, "ws")
      .replace(/\/$/, "");
    const absoluteBase = base.startsWith("ws")
      ? base
      : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${base}`;
    const socket = new WebSocket(
      `${absoluteBase}/voice-presence?roomId=${encodeURIComponent(normalizedRoomId)}`,
    );
    voicePresenceSocket = socket;
    socket.addEventListener("open", () => {
      if (voicePresenceSocket !== socket) return;
      voicePresenceReconnectAttempt = 0;
      voicePresenceHeartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: "ping" }));
      }, 20000);
    });
    socket.addEventListener("message", (event) => {
      if (voicePresenceSocket !== socket) return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "voice-presence") applyVoicePresence(payload.data);
        if (payload.type === "voice-presence-snapshot")
          for (const snapshot of payload.data?.channels || [])
            applyVoicePresence(snapshot);
      } catch (error) {
        console.warn("[ChannelsStore] Invalid voice presence update", error);
      }
    });
    socket.addEventListener("close", () => {
      if (voicePresenceSocket !== socket) return;
      voicePresenceSocket = null;
      if (voicePresenceHeartbeatTimer)
        clearInterval(voicePresenceHeartbeatTimer);
      voicePresenceHeartbeatTimer = null;
      if (voicePresenceIntentionalClose) return;
      const delay = Math.min(15000, 500 * 2 ** voicePresenceReconnectAttempt++);
      voicePresenceReconnectTimer = setTimeout(
        () => connectVoicePresence(normalizedRoomId),
        delay + Math.floor(Math.random() * 250),
      );
    });
  }

  function getVoiceProfile(userId) {
    return voiceProfiles.value.get(String(userId));
  }

  function applyRealtimePolicy(channelId, mediaPolicy) {
    const channel = channels.value.find((item) => item.id === channelId);
    if (!channel || !mediaPolicy) return false;
    if (
      Number(channel.mediaPolicy?.revision || 0) >=
      Number(mediaPolicy.revision || 0)
    )
      return false;
    channel.mediaPolicy = mediaPolicy;
    channel.audio_bitrate = mediaPolicy.microphoneKbps;
    channels.value = [...channels.value];
    return true;
  }

  return {
    channels,
    loading,
    error,
    currentChannelId,
    loadedRoomId,
    fetchChannels,
    activateRoomChannels,
    createChannel,
    editChannel,
    deleteChannel,
    joinChannel,
    leaveChannel,
    moderateVoiceParticipant,
    getChannelDetails,
    getUnreadCounts,
    getChannelById,
    getTextChannels,
    getMediaChannels,
    clearChannels,
    applyRealtimePolicy,
    connectVoicePresence,
    disconnectVoicePresence,
    getVoiceProfile,
  };
});
