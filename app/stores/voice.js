import { defineStore } from "pinia";
import { useAuthStore } from './auth';

export const useVoiceStore = defineStore('voice', () => {
    const currentChannelId = ref(null);
    const currentRoomId = ref(null);
    const connectedUsers = ref(new Map());
    // Per-participant volume (userId -> volume [0..1])
    const userVolumes = ref({});
    // Cached user profiles keyed by userId, populated from room data
    const userDirectory = ref(new Map());
    const micMuted = ref(true);
    const deafened = ref(false);
    const connecting = ref(false);
    const connected = ref(false);
    const error = ref(null);
    const connectedAt = ref(null);

    const sfuComposable = ref(null);
    // Stopper for dynamic watcher mirroring ICE connection state to connected flag
    let stopIceWatcher = null;

    // Initialize persisted preferences
    if (typeof window !== 'undefined') {
        try {
            const persistedMic = localStorage.getItem('voice.micMuted');
            if (persistedMic !== null) micMuted.value = persistedMic === 'true';
            // Restore userVolumes from localStorage
            const persistedVolumes = localStorage.getItem('voice.userVolumes');
            if (persistedVolumes) {
                try {
                    const parsed = JSON.parse(persistedVolumes);
                    if (parsed && typeof parsed === 'object') {
                        Object.assign(userVolumes.value, parsed);
                    }
                } catch (_) { /* ignore */ }
            }
        } catch (_) { /* noop */ }
    }

    // Persist preferences on change
    if (typeof window !== 'undefined') {
        watch(micMuted, (v) => {
            try { localStorage.setItem('voice.micMuted', String(!!v)) } catch (_) { /* noop */ }
        }, { immediate: true })
        watch(deafened, (v) => {
            try { localStorage.setItem('voice.deafened', String(!!v)) } catch (_) { /* noop */ }
        }, { immediate: true })
        watch(userVolumes, (vols) => {
            try { localStorage.setItem('voice.userVolumes', JSON.stringify(vols)) } catch (_) { /* noop */ }
        }, { deep: true, immediate: true })
    }

    // Watch for critical SFU errors and set connected to false and propagate error if error occurs
    if (typeof window !== 'undefined') {
        watch(
            () => sfuComposable.value && sfuComposable.value.error,
            (sfuError) => {
                try {
                    if (sfuError && typeof sfuError === 'string' && (
                        sfuError.includes('Router not ready') ||
                        sfuError.includes('Connection failed') ||
                        sfuError.includes('Failed to get RTP capabilities') ||
                        sfuError.includes('Failed to create transport') ||
                        sfuError.includes('Server error') ||
                        sfuError.includes('Connection lost') ||
                        sfuError.toLowerCase().includes('call failed')
                    )) {
                        connected.value = false;
                        error.value = sfuError;
                    }
                } catch (err) {
                    console.error('[VoiceStore] Error while leaving voice channel:', err);
                    // Keep clearing state even if disconnect throws
                    setCurrentChannel(null);
                    currentRoomId.value = null;
                    connectedUsers.value.clear();
                    connected.value = false;
                    connectedAt.value = null;
                    error.value = err?.message || String(err);
                    if (stopIceWatcher) { try { stopIceWatcher(); } catch (_) { /* noop */ } stopIceWatcher = null; }
                }
            },
            { immediate: true }
        );

        // Watch for output device changes and apply them to audio elements
        import('~/stores/settings').then(({ useSettingsStore }) => {
            const settingsStore = useSettingsStore();
            watch(
                () => settingsStore.outputDeviceId,
                () => {
                    if (sfuComposable.value && sfuComposable.value.applyOutputDeviceToAll) {
                        sfuComposable.value.applyOutputDeviceToAll();
                    }
                }
            );
        }).catch(() => {
            // Settings store not available, ignore
        });
    }

    function setCurrentChannel(channelId) {
        currentChannelId.value = channelId;
        
        // Get room ID from channel
        if (typeof window !== 'undefined') {
            import('~/stores/channels').then(({ useChannelsStore }) => {
                const channelsStore = useChannelsStore();
                const channel = channelsStore.getChannelById(channelId);
                if (channel) {
                    // Server returns 'room' for roomId; keep fallbacks for compatibility
                    currentRoomId.value = channel.room || channel.room_id || channel.roomId || null;
                }
            });
        }
    }

    // Gracefully leave the current voice channel and clear SFU state
    async function leaveVoiceChannel() {
        try {
            // Stop local production if present
            if (sfuComposable.value && typeof sfuComposable.value.stopAudioProduction === 'function') {
                try { await sfuComposable.value.stopAudioProduction(); } catch (_) { /* noop */ }
            }

            // Disconnect SFU
            if (sfuComposable.value && typeof sfuComposable.value.disconnect === 'function') {
                try { await sfuComposable.value.disconnect(); } catch (_) { /* noop */ }
            }
        } catch (err) {
            // Best-effort only
        } finally {
            if (stopIceWatcher) { try { stopIceWatcher(); } catch (_) { /* noop */ } stopIceWatcher = null; }
            setCurrentChannel(null);
            currentRoomId.value = null;
            connectedUsers.value.clear();
            connecting.value = false;
            connected.value = false;
            connectedAt.value = null;
            error.value = null;
            sfuComposable.value = null;
        }
    }

    // Upsert a user profile into the directory and merge into any connected user entry
    function upsertUserProfile(profile) {
        if (!profile || !profile.id) return;
        const prev = userDirectory.value.get(profile.id) || {};
        const merged = { ...prev, ...profile };
        userDirectory.value.set(profile.id, merged);
        // If the user is currently connected, merge into that entry as well
        const cu = connectedUsers.value.get(profile.id);
        if (cu) {
            connectedUsers.value.set(profile.id, { ...cu, ...merged });
            connectedUsers.value = new Map(connectedUsers.value);
        }
    }

    function isInVoiceChannel() {
        return !!currentChannelId.value && !!connected.value;
    }

    function addConnectedUser(userId, userInfo) {
        const cached = userDirectory.value.get(userId) || {};
    connectedUsers.value.set(userId, {
            id: userId,
            ...cached,
            ...userInfo,
            speaking: false,
            muted: false
        });
    // Force reactivity by replacing the Map reference
    connectedUsers.value = new Map(connectedUsers.value);
        // If there is no saved volume for this user, initialize it based on current element volume if available; otherwise leave undefined until the first control change
        if (typeof userVolumes.value[userId] === 'undefined' && typeof window !== 'undefined') {
            const el = document.getElementById(`audio-${userId}`)
            if (el && typeof el.volume === 'number') {
                userVolumes.value[userId] = el.volume
            }
        }
    }

    function removeConnectedUser(userId) {
    connectedUsers.value.delete(userId);
    connectedUsers.value = new Map(connectedUsers.value);
    // Do NOT delete userVolumes on disconnect; preserve user-defined settings across re-joins
    }
    function setUserVolume(userId, volume) {
        const v = Math.max(0, Math.min(1, Number(volume)));
        userVolumes.value[userId] = v;
        // Apply immediately to any live audio element(s)
        if (typeof window !== 'undefined') {
            try {
                // Direct element by final user id
                const audio = document.getElementById(`audio-${userId}`);
                if (audio) {
                    audio.volume = v;
                }
                // Use SFU helper to cover mapping races or multiple elements
                if (sfuComposable.value && typeof sfuComposable.value.applyVolumeForUser === 'function') {
                    sfuComposable.value.applyVolumeForUser(userId, v);
                }
            } catch (_) { /* noop */ }
        }
    }
    function getUserVolume(userId) {
        return typeof userVolumes.value[userId] !== 'undefined' ? userVolumes.value[userId] : 1.0;
    }

    function updateUserSpeaking(userId, speaking) {
        // Only update known users to prevent phantom entries created from producer IDs
        const user = connectedUsers.value.get(userId);
        if (!user) {
            return;
        }
        connectedUsers.value.set(userId, { ...user, speaking });
        connectedUsers.value = new Map(connectedUsers.value);
    }

    function updateUserMuted(userId, muted) {
        const user = connectedUsers.value.get(userId);
        if (user) {
            connectedUsers.value.set(userId, { ...user, muted });
            connectedUsers.value = new Map(connectedUsers.value);
        }
    }

    async function joinVoiceChannel(channelId) {
        if (currentChannelId.value === channelId && connected.value && !connecting.value) {
            return;
        }

        if (connecting.value) {
            return;
        }

    let joinedSuccessfully = false;
    try {
            connecting.value = true;
            error.value = null;

                if (connected.value && currentChannelId.value !== channelId) {
                await leaveVoiceChannel();
            }

            // Check microphone permission before connecting
            let micPermission = 'prompt';
            if (typeof navigator !== 'undefined' && navigator.permissions) {
                try {
                    const status = await navigator.permissions.query({ name: 'microphone' });
                    micPermission = status.state;
                } catch (e) {
                    // Fallback: try to getUserMedia and catch error
                    try {
                        await navigator.mediaDevices.getUserMedia({ audio: true });
                        micPermission = 'granted';
                    } catch (err) {
                        micPermission = 'denied';
                    }
                }
            }

            const { useMediasoupSfu } = await import('~/composables/useMediasoupSfu');
            sfuComposable.value = useMediasoupSfu();
            // Keep voiceStore.connected in sync with actual ICE state after we attach SFU
            if (stopIceWatcher) { try { stopIceWatcher(); } catch (_) { /* noop */ } stopIceWatcher = null; }
            stopIceWatcher = watch(
                () => sfuComposable.value && sfuComposable.value.iceConnectedBoth,
                (v) => {
                    // Only reflect true connected state when both transports are ICE-connected
                    connected.value = !!v;
                }
            );

            await sfuComposable.value.connect(channelId);
            setCurrentChannel(channelId);

            // Only proceed if there is no immediate SFU error
            if (!sfuComposable.value.error) {
                // Respect persisted mic preference if available; otherwise follow permission-based default
                let persistedMic = null;
                try {
                    if (typeof window !== 'undefined') {
                        const v = localStorage.getItem('voice.micMuted');
                        if (v !== null) persistedMic = v === 'true';
                    }
                } catch (_) { /* noop */ }
                if (persistedMic !== null) {
                    micMuted.value = persistedMic;
                }

                // Wait until transports are created
                while (!sfuComposable.value.transportReady) {
                    await new Promise(res => setTimeout(res, 50));
                }
                
                // Give SFU time to process initial messages (currentlyInChannel, etc.)
                await new Promise(res => setTimeout(res, 200));
                
                // Broadcast mode: only require send transport ICE connection
                const { useSettingsStore } = await import('~/stores/settings');
                const settingsStore = useSettingsStore();
                const isBroadcast = settingsStore.broadcastMode;
                const timeoutMs = 45000;
                const startTime = Date.now();
                let connectedOk = false;
                // Use the new areTransportsIceConnected helper for both modes
                while (Date.now() - startTime < timeoutMs) {
                    // If truly alone, treat as connected
                    if (sfuComposable.value) {
                        try {
                            // Access values directly - they're already unwrapped in this context
                            const remoteCount = sfuComposable.value.remoteProducersCount ?? -1;
                            const roomUsers = sfuComposable.value.lastInRoom ?? [];
                            // Treat single-user rooms as connected
                            if (remoteCount === 0 && Array.isArray(roomUsers) && roomUsers.length === 1) {
                                connectedOk = true;
                                break;
                            }
                        } catch (err) {
                            console.error('[VoiceStore] Error checking alone status:', err);
                        }
                    }
                    if (await sfuComposable.value.areTransportsIceConnected?.(isBroadcast)) {
                        connectedOk = true;
                        break;
                    }
                    if (sfuComposable.value.error) throw new Error(sfuComposable.value.error);
                    await new Promise(res => setTimeout(res, 100));
                }
                if (!connectedOk) {
                    error.value = 'Call Failed: Connection timed out';
                    if (sfuComposable.value && sfuComposable.value.disconnect) {
                        try { sfuComposable.value.disconnect(); } catch (_) {}
                    }
                    throw new Error(error.value);
                }

                // Start mic only if not muted
                if (!micMuted.value) {
                    try {
                        await sfuComposable.value.startAudioProduction();
                    } catch (err) {
                        // If mic fails to start, keep muted but still consider connected at transport level
                        micMuted.value = true;
                    }
                } else if (sfuComposable.value.stopAudioProduction) {
                    try { await sfuComposable.value.stopAudioProduction() } catch (_) { /* noop */ }
                }

                connected.value = true;
                connectedAt.value = Date.now();
                // Mark success so finalizer doesn't tear down a working connection
                joinedSuccessfully = true;
            } else {
                connected.value = false;
                error.value = sfuComposable.value.error;
                throw new Error(sfuComposable.value.error);
            }
        } catch (err) {
            console.error('[VoiceStore] Failed to join voice channel:', err);
            error.value = err.message;

            // Show error notification
            if (typeof window !== 'undefined') {
                const { useToast } = await import('~/composables/useToast');
                const { error: showError } = useToast();
                showError(`Failed to connect to voice: ${err.message}`);
            }

            throw err;
        }
        finally {
            // Always stop the connecting flag when the attempt finishes
            connecting.value = false;

            // Only clear SFU state when we did NOT join successfully.
            // If joinedSuccessfully is true, keep sfuComposable and connected state intact.
            if (!joinedSuccessfully) {
                try {
                    // Access values directly - they're already unwrapped in this context
                    const remoteCount = sfuComposable.value?.remoteProducersCount ?? -1;
                    const roomUsers = sfuComposable.value?.lastInRoom ?? [];
                    if (remoteCount === 0 && Array.isArray(roomUsers) && roomUsers.length === 1) {
                        // no-op
                    }
                } catch (err) {
                    // Error checking alone status
                }
                connectedUsers.value.clear();
                connected.value = false;
                connectedAt.value = null;
                // preserve any error set by catch so callers can inspect it
                // do not overwrite error.value here
                sfuComposable.value = joinedSuccessfully ? sfuComposable.value : null;
            }
        }
    }

    async function toggleMic() {
        if (!sfuComposable.value) {
            console.warn('[VoiceStore] Cannot toggle mic: SFU not initialized');
            return;
        }

        try {
            if (micMuted.value) {
                // Unmute flow
                // Ensure transports are ready (bounded wait)
                const start = Date.now();
                const waitMs = 5000;
                while (!sfuComposable.value.transportReady && (Date.now() - start) < waitMs) {
                    await new Promise(res => setTimeout(res, 50));
                }
                if (!sfuComposable.value.transportReady) {
                    throw new Error('Voice transport not ready');
                }

                try {
                    await sfuComposable.value.startAudioProduction();
                    micMuted.value = false;
                } catch (err) {
                    micMuted.value = true;
                    throw err;
                }
            } else {
                // Mute flow
                try { if (sfuComposable.value.stopAudioProduction) { await sfuComposable.value.stopAudioProduction() } } catch (_) { /* noop */ }
                micMuted.value = true;
            }
        } catch (err) {
            console.error('[VoiceStore] Error toggling microphone:', err);
            error.value = err?.message || String(err);
            if (typeof window !== 'undefined') {
                const { useToast } = await import('~/composables/useToast');
                const { error: showError } = useToast();
                showError(`Microphone error: ${error.value}`);
            }
        }
    }

    function toggleDeafen() {
        if (!connected.value) {
            console.warn('[VoiceStore] Cannot toggle deafen: not connected');
            return;
        }

        deafened.value = !deafened.value;
        if (deafened.value && !micMuted.value) {
            toggleMic();
        }

        if (typeof window !== 'undefined') {
            const container = document.getElementById('webrtc-audio-global');
            if (container) {
                const audios = container.querySelectorAll('audio');
                audios.forEach(audio => {
                    audio.muted = deafened.value;
                });
            }

        }

    // Deafened state updated
    }

    function clearVoiceState() {
        if (connected.value) {
            leaveVoiceChannel();
        }
    if (stopIceWatcher) { try { stopIceWatcher(); } catch (_) { /* noop */ } stopIceWatcher = null; }
        
        setCurrentChannel(null);
        connectedUsers.value.clear();
        connecting.value = false;
        connected.value = false;
        error.value = null;
        sfuComposable.value = null;
    }

    function getConnectedUsersArray() {
        return Array.from(connectedUsers.value.values());
    }

    // Returns a sanitized list safe for UI display:
    // - Always include users present in userDirectory (room members/owner)
    // - Include any connected user that has a live audio element
    // - Include non-UUID-looking IDs (often short ids)
    // - Exclude only IDs that look like producer-only UUIDs and have no audio/userDirectory backing
    function getDisplayUsersArray() {
        const users = Array.from(connectedUsers.value.values());
        const isUuidV4 = (id) => typeof id === 'string' && /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id);
        const knownIds = new Set(Array.from(userDirectory.value.keys()));
        const liveAudioIds = new Set();
        
        if (typeof window !== 'undefined') {
            const container = document.getElementById('webrtc-audio-global');
            if (container) {
                container.querySelectorAll('audio').forEach((el) => {
                    const uid = el.getAttribute('data-user-id');
                    if (uid) liveAudioIds.add(uid);
                })
            }
        }
        
        const result = [];
        const seen = new Set();
        for (const u of users) {
            const id = String(u.id);
            const inDirectory = knownIds.has(id);
            const hasAudio = liveAudioIds.has(id);
            const notUuid = !isUuidV4(id);
            const include = inDirectory || hasAudio || notUuid;
            
            if (include && !seen.has(id)) {
                seen.add(id);
                result.push(u);
            }
        }
        
        return result;
    }

    function isUserConnected(userId) {
        return connectedUsers.value.has(userId);
    }

    function getUserById(userId) {
        return connectedUsers.value.get(userId);
    }


    async function applyOutputDevice() {
        if (sfuComposable.value && typeof sfuComposable.value.applyOutputDeviceToAll === 'function') {
            try {
                await sfuComposable.value.applyOutputDeviceToAll();
            } catch (_) {
                /* noop */
            }
        }
    }
    function getUserProfile(userId) {
        return userDirectory.value.get(userId)
    }

    // When channels list refreshes or currentRoomId changes, hydrate directory from room members
    if (typeof window !== 'undefined') {
        import('~/stores/rooms').then(({ useRoomsStore }) => {
            const roomsStore = useRoomsStore()
            watch([() => roomsStore.rooms, currentRoomId], ([rooms]) => {
                try {
                    if (!currentRoomId.value) return
                    const room = Array.isArray(rooms) ? rooms.find(r => r.id === currentRoomId.value) : null
                    if (room) {
                        if (Array.isArray(room.members)) {
                            room.members.forEach((m) => upsertUserProfile({
                                id: m.id,
                                display_name: m.name || m.email || m.id,
                                username: m.name || m.email || m.id,
                                name: m.name,
                                email: m.email,
                                avatar: m.avatar
                            }))
                        }
                        if (room.owner && room.owner.id) {
                            upsertUserProfile({
                                id: room.owner.id,
                                display_name: room.owner.name || room.owner.email || room.owner.id,
                                username: room.owner.name || room.owner.email || room.owner.id,
                                name: room.owner.name,
                                email: room.owner.email,
                                avatar: room.owner.avatar
                            })
                        }
                    }
                } catch (_) { /* noop */ }
            }, { immediate: true, deep: true })
        })
    }

    return {
        currentChannelId: readonly(currentChannelId),
        currentRoomId: readonly(currentRoomId),
        connectedUsers: readonly(connectedUsers),
        micMuted: readonly(micMuted),
        deafened: readonly(deafened),
        connecting: readonly(connecting),
        connected: readonly(connected),
        error, // not readonly, so it can be set from components
        connectedAt: readonly(connectedAt),
        sfuComposable: readonly(sfuComposable),
        joinVoiceChannel,
        leaveVoiceChannel,
        toggleMic,
        toggleDeafen,
        addConnectedUser,
        removeConnectedUser,
        updateUserSpeaking,
        updateUserMuted,
        clearVoiceState,
        getConnectedUsersArray,
        getDisplayUsersArray,
        isUserConnected,
        getUserById,
        isInVoiceChannel,
        upsertUserProfile,
        getUserProfile,
        setUserVolume,
        getUserVolume,
        userVolumes: readonly(userVolumes),
        applyOutputDevice
    }
});
