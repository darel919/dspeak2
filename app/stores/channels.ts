import { defineStore } from "pinia";
import { debugLog } from "../shared/debug";
import { useRuntimeConfig } from "#app";
import { useAuthStore } from "./auth";
import { openRealtimeChannel } from "../shared/realtime-channel.ts";
import type { RealtimeChannelLike } from "../shared/realtime-channel.ts";
import {
  normalizeChannelPolicy,
  normalizeSlowMode,
} from "~~/shared/channel-policy.ts";
import type {
  ChannelInput,
  ChannelPolicyUpdate,
  ChannelRecord,
  FetchChannelsOptions,
  VoicePresenceConnection,
  VoicePresenceSnapshot,
} from "../shared/types/channels.ts";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const useChannelsStore = defineStore("channels", () => {
  const channels = ref<ChannelRecord[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const currentChannelId = ref<string | null>(null);
  const voiceProfiles = ref<Map<string, Record<string, unknown>>>(new Map());
  const loadedRoomId = ref<string | null>(null);
  const roomChannels = reactive(new Map<string, ChannelRecord[]>());
  const pendingRoomRequests = new Map<string, Promise<ChannelRecord[]>>();
  const voicePresenceConnections = new Map<string, VoicePresenceConnection>();
  const voicePresenceSnapshots = new Map<
    string,
    Map<string, VoicePresenceSnapshot>
  >();
  const channelPolicies = ref<Map<string, Record<string, unknown>>>(new Map());
  const config = useRuntimeConfig();

  async function fetchChannels(
    roomId: string,
    options: FetchChannelsOptions = {},
  ): Promise<ChannelRecord[]> {
    if (!roomId) {
      throw new Error("Room ID is required");
    }

    const normalizedRoomId = String(roomId);
    const activate = options.activate !== false;
    const force = options.force === true;
    if (!force && roomChannels.has(normalizedRoomId)) {
      const cachedChannels = roomChannels.get(normalizedRoomId);
      applyStoredVoicePresence(normalizedRoomId);
      if (activate && cachedChannels)
        activateRoomChannels(normalizedRoomId, cachedChannels);
      return cachedChannels || [];
    }
    if (pendingRoomRequests.has(normalizedRoomId)) {
      const pendingChannels = await pendingRoomRequests.get(normalizedRoomId);
      if (!pendingChannels) return [];
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

  function activateRoomChannels(roomId: string, nextChannels: ChannelRecord[]) {
    channels.value = nextChannels;
    loadedRoomId.value = String(roomId);
    applyStoredVoicePresence(roomId);
  }

  function getRoomChannelById(roomId: string, channelId: string) {
    const roomChannelList = roomChannels.get(String(roomId || ""));
    if (!roomChannelList) return null;
    return (
      roomChannelList.find(
        (channel) => String(channel.id) === String(channelId || ""),
      ) || null
    );
  }

  function getRoomChannels(roomId: string) {
    return roomChannels.get(String(roomId || "")) || [];
  }

  async function fetchChannelsFromServer(
    roomId: string,
  ): Promise<ChannelRecord[]> {
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

      const data: unknown = await response.json();
      const nextChannels = (Array.isArray(data) ? data : []) as ChannelRecord[];
      roomChannels.set(String(roomId), nextChannels);
      applyStoredVoicePresence(roomId);
      debugLog("[ChannelsStore] Fetched channels:", nextChannels);

      return nextChannels;
    } catch (err: unknown) {
      error.value = errorMessage(err);
      console.error("[ChannelsStore] Error fetching channels:", err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function createChannel(roomId: string, channelData: ChannelInput) {
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
    } catch (err: unknown) {
      error.value = errorMessage(err);
      console.error("[ChannelsStore] Error creating channel:", err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function editChannel(
    channelId: string,
    channelData: Partial<ChannelInput>,
  ) {
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
        const existingChannel = channels.value[channelIndex];
        if (!existingChannel) return false;
        channels.value[channelIndex] = {
          ...existingChannel,
          ...channelData,
          id: existingChannel.id,
          inRoom: existingChannel.inRoom,
        };
        channels.value = [...channels.value];
        if (loadedRoomId.value)
          roomChannels.set(loadedRoomId.value, channels.value);
      }

      return true;
    } catch (err: unknown) {
      error.value = errorMessage(err);
      console.error("[ChannelsStore] Error editing channel:", err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function deleteChannel(channelId: string) {
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
    } catch (err: unknown) {
      error.value = errorMessage(err);
      console.error("[ChannelsStore] Error deleting channel:", err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function joinChannel(channelId: string) {
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
        const channel = channels.value.find((item) => item.id === channelId);
        if (!channel) return false;
        const normalizedUserId = String(userData.id);
        if (!channel.inRoom.includes(normalizedUserId)) {
          channel.inRoom.push(normalizedUserId);
        }
      }

      return true;
    } catch (err) {
      console.error("[ChannelsStore] Error joining channel:", err);
      throw err;
    }
  }

  async function leaveChannel(channelId: string) {
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
        const channel = channels.value.find((item) => item.id === channelId);
        if (!channel) return false;
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
    channelId: string,
    targetUserId: string,
    targetChannelId: string | null = null,
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

  async function getChannelDetails(channelId: string) {
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

  function getChannelById(channelId: string | null) {
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
    voicePresenceSnapshots.clear();
    voiceProfiles.value = new Map();
    channelPolicies.value = new Map();
    currentChannelId.value = null;
    error.value = null;
  }

  function storeVoicePresenceSnapshot(
    snapshot: VoicePresenceSnapshot,
    roomId: string,
  ) {
    const normalizedRoomId = String(roomId || "");
    if (!normalizedRoomId) return;
    let snapshots = voicePresenceSnapshots.get(normalizedRoomId);
    if (!snapshots) {
      snapshots = new Map();
      voicePresenceSnapshots.set(normalizedRoomId, snapshots);
    }
    const channelId = String(snapshot.channelId);
    snapshots.set(channelId, {
      ...snapshot,
      channelId,
      inRoom: [...new Set(snapshot.inRoom.map(String))],
      participantStates: Array.isArray(snapshot.participantStates)
        ? snapshot.participantStates.map((state) => ({ ...state }))
        : [],
      profiles: Array.isArray(snapshot.profiles)
        ? snapshot.profiles.map((profile) => ({ ...profile }))
        : [],
    });
  }

  function clearStoredVoicePresence(roomId: string, channelId: string) {
    const snapshots = voicePresenceSnapshots.get(String(roomId || ""));
    if (!snapshots) return;
    snapshots.delete(String(channelId));
    if (!snapshots.size) voicePresenceSnapshots.delete(String(roomId));
  }

  function applyVoicePresenceToChannel(
    snapshot: VoicePresenceSnapshot,
    roomId: string | null = null,
  ) {
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

  function applyStoredVoicePresence(roomId: string) {
    const normalizedRoomId = String(roomId || "");
    const snapshots = voicePresenceSnapshots.get(normalizedRoomId);
    if (!snapshots) return;
    for (const snapshot of snapshots.values())
      applyVoicePresence(snapshot, normalizedRoomId);
    if (!snapshots.size) voicePresenceSnapshots.delete(normalizedRoomId);
  }

  function applyVoicePresence(
    snapshot: VoicePresenceSnapshot,
    roomId: string | null = null,
  ) {
    if (!snapshot?.channelId || !Array.isArray(snapshot.inRoom)) return false;
    const normalizedRoomId = String(roomId || loadedRoomId.value || "");
    if (normalizedRoomId)
      storeVoicePresenceSnapshot(snapshot, normalizedRoomId);
    const applied = applyVoicePresenceToChannel(snapshot, roomId);
    if (applied && normalizedRoomId)
      clearStoredVoicePresence(normalizedRoomId, snapshot.channelId);
    return applied;
  }

  function disconnectVoicePresence(roomId: string | null = null) {
    const roomIds = roomId
      ? [String(roomId)]
      : [
          ...new Set([
            ...voicePresenceConnections.keys(),
            ...voicePresenceSnapshots.keys(),
          ]),
        ];
    for (const normalizedRoomId of roomIds) {
      const connection = voicePresenceConnections.get(normalizedRoomId);
      voicePresenceSnapshots.delete(normalizedRoomId);
      if (!connection) continue;
      connection.intentionalClose = true;
      connection.connecting = false;
      if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
      connection.reconnectTimer = null;
      voicePresenceConnections.delete(normalizedRoomId);
      connection.close?.();
    }
  }

  function scheduleVoicePresenceReconnect(
    normalizedRoomId: string,
    connection: VoicePresenceConnection,
  ) {
    if (connection.intentionalClose || connection.reconnectTimer) return;
    const delay = Math.min(15000, 500 * 2 ** connection.reconnectAttempt++);
    connection.reconnectTimer = setTimeout(
      () => {
        connection.reconnectTimer = null;
        connectVoicePresence(normalizedRoomId);
      },
      delay + Math.floor(Math.random() * 250),
    );
  }

  function connectVoicePresence(roomId: string) {
    if (!import.meta.client || !roomId) return;
    const normalizedRoomId = String(roomId);
    const existing = voicePresenceConnections.get(normalizedRoomId);
    if (existing?.channel || existing?.connecting || existing?.reconnectTimer)
      return;
    const connection = existing || {
      channel: null,
      reconnectTimer: null,
      reconnectAttempt: 0,
      intentionalClose: false,
      connecting: false,
    };
    connection.intentionalClose = false;
    connection.connecting = true;
    voicePresenceConnections.set(normalizedRoomId, connection);
    openRealtimeChannel<Record<string, unknown>>(`room:${normalizedRoomId}`, {
      onMessage: (message) => {
        if (message?.type === "voice-presence") {
          if (message.data && typeof message.data === "object")
            applyVoicePresence(
              message.data as VoicePresenceSnapshot,
              normalizedRoomId,
            );
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
        connection.connecting = false;
        if (connection.intentionalClose) return;
        scheduleVoicePresenceReconnect(normalizedRoomId, connection);
      },
    })
      .then((handle) => {
        connection.connecting = false;
        if (!handle) {
          scheduleVoicePresenceReconnect(normalizedRoomId, connection);
          return;
        }
        if (connection.intentionalClose) {
          handle.close();
          return;
        }
        connection.channel = handle.channel as RealtimeChannelLike;
        connection.close = handle.close;
      })
      .catch((err) => {
        connection.connecting = false;
        if (connection.intentionalClose) return;
        console.warn(
          "[ChannelsStore] Unable to open voice presence channel:",
          err,
        );
        scheduleVoicePresenceReconnect(normalizedRoomId, connection);
      });
  }

  function syncVoicePresenceRooms(roomIds: unknown) {
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

  function getVoiceProfile(userId: string | number) {
    return voiceProfiles.value.get(String(userId));
  }

  function applyRealtimePolicy(
    channelId: string,
    data: Record<string, unknown>,
  ) {
    if (data.mediaPolicy && typeof data.mediaPolicy === "object") {
      const nextMediaPolicy = data.mediaPolicy as ChannelRecord["mediaPolicy"];
      const channel = channels.value.find((item) => item.id === channelId);
      if (!channel) return false;
      if (
        Number(channel.mediaPolicy?.revision || 0) >=
        Number(nextMediaPolicy?.revision || 0)
      )
        return false;
      channel.mediaPolicy = nextMediaPolicy;
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

  async function updateChannelPolicy(
    channelId: string,
    { policy, slowMode }: ChannelPolicyUpdate,
  ) {
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

  function getChannelPolicy(channelId: string) {
    return channelPolicies.value.get(String(channelId)) || null;
  }

  function getChannelSendPermission(channelId: string) {
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
