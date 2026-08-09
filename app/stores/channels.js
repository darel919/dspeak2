import { defineStore } from "pinia";
import { debugLog } from "../shared/debug";
import { useRuntimeConfig } from "#app";
import { useAuthStore } from "./auth";
import { openRealtimeChannel } from "../shared/realtime-channel.js";
import {
  normalizeChannelPolicy,
  normalizeSlowMode,
} from "~~/shared/channel-policy.js";

export const useChannelsStore = defineStore("channels", () => {
  const channels = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const currentChannelId = ref(null);
  const voiceProfiles = ref(new Map());
  const loadedRoomId = ref(null);
  const roomChannels = reactive(new Map());
  const pendingRoomRequests = new Map();
  const voicePresenceConnections = new Map();
  const channelPolicies = ref(new Map());
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

  function getRoomChannelById(roomId, channelId) {
    const roomChannelList = roomChannels.get(String(roomId || ""));
    if (!roomChannelList) return null;
    return (
      roomChannelList.find(
        (channel) => String(channel.id) === String(channelId || ""),
      ) || null
    );
  }

  function getRoomChannels(roomId) {
    return roomChannels.get(String(roomId || "")) || [];
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
      debugLog("[ChannelsStore] Fetched channels:", nextChannels);

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
          mediaPolicy: channelData.mediaPolicy || null,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to create channel: ${response.status} ${errorText}`,
        );
      }

      const newChannel = await response.json();
      debugLog("[ChannelsStore] Created channel:", newChannel);

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
          mediaPolicy: channelData.mediaPolicy,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to edit channel: ${response.status} ${errorText}`,
        );
      }

      debugLog("[ChannelsStore] Edited channel:", channelId);

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

      debugLog("[ChannelsStore] Deleted channel:", channelId);

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

      debugLog("[ChannelsStore] Joined channel:", channelId);

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
        credentials: "include",
        keepalive: true,
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

      debugLog("[ChannelsStore] Left channel:", channelId);

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
        const error = new Error(
          response.status === 403 || response.status === 404
            ? "Invalid link"
            : "Failed to fetch channel details",
        );
        error.status = response.status;
        throw error;
      }

      const channelDetails = await response.json();
      debugLog("[ChannelsStore] Fetched channel details:", channelDetails);

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
      debugLog("[ChannelsStore] Fetched unread counts:", unreadCounts);

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

  function applyVoicePresence(snapshot, roomId = null) {
    if (!snapshot?.channelId || !Array.isArray(snapshot.inRoom)) return false;
    const roomChannelList = roomId
      ? roomChannels.get(String(roomId)) || []
      : channels.value;
    const channel = roomChannelList.find(
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
    if (
      String(loadedRoomId.value || "") === String(roomId || "") ||
      channels.value.includes(channel)
    )
      channels.value = [...channels.value];
    return true;
  }

  function disconnectVoicePresence(roomId = null) {
    const roomIds = roomId
      ? [String(roomId)]
      : [...voicePresenceConnections.keys()];
    for (const normalizedRoomId of roomIds) {
      const connection = voicePresenceConnections.get(normalizedRoomId);
      if (!connection) continue;
      connection.intentionalClose = true;
      if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
      voicePresenceConnections.delete(normalizedRoomId);
      connection.close?.();
    }
  }

  function connectVoicePresence(roomId) {
    if (!import.meta.client || !roomId) return;
    const normalizedRoomId = String(roomId);
    const existing = voicePresenceConnections.get(normalizedRoomId);
    if (existing?.channel) return;
    const connection = existing || {
      channel: null,
      reconnectTimer: null,
      reconnectAttempt: 0,
      intentionalClose: false,
    };
    connection.intentionalClose = false;
    voicePresenceConnections.set(normalizedRoomId, connection);
    openRealtimeChannel(`room:${normalizedRoomId}`, {
      onMessage: (message) => {
        if (message?.type === "voice-presence") {
          applyVoicePresence(message.data, normalizedRoomId);
        }
      },
      onSubscribe: () => {
        connection.reconnectAttempt = 0;
      },
      onError: (err, status) => {
        console.warn(
          "[ChannelsStore] Voice presence channel error:",
          err,
          status,
        );
        connection.channel = null;
        if (connection.intentionalClose) return;
        const delay = Math.min(15000, 500 * 2 ** connection.reconnectAttempt++);
        connection.reconnectTimer = setTimeout(
          () => connectVoicePresence(normalizedRoomId),
          delay + Math.floor(Math.random() * 250),
        );
      },
    }).then((handle) => {
      if (!handle) return;
      if (connection.intentionalClose) {
        handle.close();
        return;
      }
      connection.channel = handle.channel;
      connection.close = handle.close;
    });
  }

  function syncVoicePresenceRooms(roomIds) {
    if (!import.meta.client) return;
    const desiredRoomIds = new Set(
      (Array.isArray(roomIds) ? roomIds : [])
        .filter(Boolean)
        .map((roomId) => String(roomId)),
    );
    for (const roomId of voicePresenceConnections.keys())
      if (!desiredRoomIds.has(roomId)) disconnectVoicePresence(roomId);
    for (const roomId of desiredRoomIds) connectVoicePresence(roomId);
  }

  function getVoiceProfile(userId) {
    return voiceProfiles.value.get(String(userId));
  }

  function applyRealtimePolicy(channelId, data) {
    if (data?.mediaPolicy) {
      const channel = channels.value.find((item) => item.id === channelId);
      if (!channel) return false;
      if (
        Number(channel.mediaPolicy?.revision || 0) >=
        Number(data.mediaPolicy.revision || 0)
      )
        return false;
      channel.mediaPolicy = data.mediaPolicy;
      channels.value = [...channels.value];
      return true;
    }

    if (data?.policy || data?.slow_mode !== undefined) {
      const channel = channels.value.find((item) => item.id === channelId);
      if (!channel) return false;
      if (data.policy !== undefined) {
        channel.policy = normalizeChannelPolicy(data.policy);
      }
      if (data.slow_mode !== undefined) {
        channel.slow_mode = normalizeSlowMode(data.slow_mode);
      }
      channelPolicies.value.set(String(channelId), {
        policy: channel.policy,
        slow_mode: channel.slow_mode,
      });
      channelPolicies.value = new Map(channelPolicies.value);
      channels.value = [...channels.value];
      return true;
    }

    return false;
  }

  async function updateChannelPolicy(channelId, { policy, slowMode }) {
    const authStore = useAuthStore();
    const userData = authStore.getUserData();
    if (!userData?.id) throw new Error("User not authenticated");

    const response = await fetch(`${config.public.apiPath}/channel-policy`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId, policy, slowMode }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        text || `Failed to update channel policy: ${response.status}`,
      );
    }

    const result = await response.json();
    applyRealtimePolicy(channelId, result);
    return result;
  }

  function getChannelPolicy(channelId) {
    return channelPolicies.value.get(String(channelId)) || null;
  }

  function getChannelSendPermission(channelId) {
    const channel = channels.value.find(
      (c) => String(c.id) === String(channelId),
    );
    if (!channel) return { canSend: true, slowModeSeconds: 0 };

    const policy = channelPolicies.value.get(String(channelId)) || {
      policy: channel.policy || "free",
      slow_mode: channel.slow_mode || 0,
    };

    const effectivePolicy = policy.policy || "free";
    const effectiveSlowMode = policy.slow_mode || 0;

    let canSend = true;
    if (effectivePolicy === "read_only") canSend = false;
    if (effectivePolicy === "moderator_only") {
      const roomInfo = channel;
      canSend = Boolean(
        roomInfo?.isModerator || roomInfo?.isAdmin || roomInfo?.isOwner,
      );
    }

    return { canSend, slowModeSeconds: effectiveSlowMode };
  }

  return {
    channels,
    loading,
    error,
    currentChannelId,
    loadedRoomId,
    channelPolicies,
    fetchChannels,
    activateRoomChannels,
    getRoomChannelById,
    getRoomChannels,
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
    updateChannelPolicy,
    getChannelPolicy,
    getChannelSendPermission,
    connectVoicePresence,
    disconnectVoicePresence,
    syncVoicePresenceRooms,
    getVoiceProfile,
  };
});
