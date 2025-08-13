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
                if (sfuError && typeof sfuError === 'string' && (
                    sfuError.includes('Router not ready') ||
                    sfuError.includes('Connection failed') ||
                    sfuError.includes('Failed to get RTP capabilities') ||
                    sfuError.includes('Failed to create transport') ||
                    sfuError.includes('Server error') ||
                    sfuError.includes('Connection lost')
                )) {
                    connected.value = false;
                    error.value = sfuError;
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
        // Default volume to 1.0 if not set
        if (typeof userVolumes.value[userId] === 'undefined') {
            userVolumes.value[userId] = 1.0;
        }
    }

    function removeConnectedUser(userId) {
    connectedUsers.value.delete(userId);
    connectedUsers.value = new Map(connectedUsers.value);
        delete userVolumes.value[userId];
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
            console.log('[VoiceStore] Already connected to channel:', channelId);
            return;
        }

        if (connecting.value) {
            console.log('[VoiceStore] Already connecting, ignoring duplicate request');
            return;
        }

        try {
            connecting.value = true;
            error.value = null;

            if (connected.value && currentChannelId.value !== channelId) {
                console.log('[VoiceStore] Switching from channel', currentChannelId.value, 'to', channelId);
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

            await sfuComposable.value.connect(channelId);
            setCurrentChannel(channelId);

            // Only set connected if there is no SFU error
            if (!sfuComposable.value.error) {
                connected.value = true;
                connectedAt.value = Date.now();

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

                // Always ensure micMuted state is respected: do NOT start audio if muted
                if (!micMuted.value) {
                    // Attempt to start mic if unmuted and transports ready
                    try {
                        if (sfuComposable.value.transportReady) {
                            await sfuComposable.value.startAudioProduction();
                        }
                    } catch (err) {
                        // keep state; error will show via toast
                    }
                } else {
                    // If muted, ensure audio is NOT started
                    try {
                        if (sfuComposable.value.stopAudioProduction) {
                            sfuComposable.value.stopAudioProduction();
                        }
                    } catch (_) { /* noop */ }
                }

                // If no persistedMic, set based on permission
                if (persistedMic === null) {
                    if (micPermission === 'denied') {
                        micMuted.value = true;
                    } else if (micPermission === 'granted') {
                        micMuted.value = false;
                        try {
                            if (sfuComposable.value.transportReady) {
                                await sfuComposable.value.startAudioProduction();
                            }
                        } catch (_) { /* noop */ }
                    } else {
                        // If prompt, ask for permission now
                        try {
                            await navigator.mediaDevices.getUserMedia({ audio: true });
                            micMuted.value = false;
                            if (sfuComposable.value.transportReady) {
                                await sfuComposable.value.startAudioProduction();
                            }
                        } catch (err) {
                            micMuted.value = true;
                        }
                    }
                }

                console.log('[VoiceStore] Successfully joined voice channel:', channelId);

                // Show success notification
                if (typeof window !== 'undefined') {
                    const { useToast } = await import('~/composables/useToast');
                    const { success } = useToast();
                    success('Connected to voice channel');
                }
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
        } finally {
            connecting.value = false;
        }
    }

    async function leaveVoiceChannel() {
        if (!connected.value) {
            return;
        }

        try {
            console.log('[VoiceStore] Leaving voice channel:', currentChannelId.value);
            
            if (sfuComposable.value) {
                sfuComposable.value.disconnect();
                sfuComposable.value = null;
            }

            setCurrentChannel(null);
            currentRoomId.value = null;
            connectedUsers.value.clear();
            connected.value = false;
            connectedAt.value = null;
            error.value = null;

            console.log('[VoiceStore] Successfully left voice channel');
            
            // Show leave notification
            if (typeof window !== 'undefined') {
                const { useToast } = await import('~/composables/useToast');
                const { info } = useToast();
                info('Disconnected from voice channel');
            }
        } catch (err) {
            console.error('[VoiceStore] Error leaving voice channel:', err);
            error.value = err.message;
        }
    }

    async function toggleMic() {
        if (!connected.value || !sfuComposable.value) {
            console.warn('[VoiceStore] Cannot toggle mic: not connected');
            return;
        }

        try {
            if (micMuted.value) {
                // Ask for permission if not already granted
                let micPermission = 'prompt';
                if (typeof navigator !== 'undefined' && navigator.permissions) {
                    try {
                        const status = await navigator.permissions.query({ name: 'microphone' });
                        micPermission = status.state;
                    } catch (e) {
                        // fallback
                    }
                }
                if (micPermission !== 'granted') {
                    try {
                        await navigator.mediaDevices.getUserMedia({ audio: true });
                        micPermission = 'granted';
                    } catch (err) {
                        micPermission = 'denied';
                    }
                }
                if (micPermission !== 'granted') {
                    micMuted.value = true;
                    if (typeof window !== 'undefined') {
                        const { useToast } = await import('~/composables/useToast');
                        const { error: showError } = useToast();
                        showError('Microphone permission denied. Please allow access to unmute.');
                    }
                    return;
                }
                // Check if transports are ready before starting audio production
                if (!sfuComposable.value.transportReady) {
                    console.log('[VoiceStore] Waiting for transports to be ready...');
                    // Wait a bit for transports to be ready
                    let attempts = 0;
                    while (!sfuComposable.value.transportReady && attempts < 50) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        attempts++;
                    }
                    if (!sfuComposable.value.transportReady) {
                        throw new Error('Transports not ready. Please try again in a moment.');
                    }
                }
                await sfuComposable.value.startAudioProduction();
                micMuted.value = false;
                console.log('[VoiceStore] Microphone unmuted');
            } else {
                sfuComposable.value.stopAudioProduction();
                micMuted.value = true;
                console.log('[VoiceStore] Microphone muted');
            }
        } catch (err) {
            console.error('[VoiceStore] Error toggling microphone:', err);
            error.value = err.message;
            // Show error notification
            if (typeof window !== 'undefined') {
                const { useToast } = await import('~/composables/useToast');
                const { error: showError } = useToast();
                showError(`Microphone error: ${err.message}`);
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

        // Apply deafened state to all audio elements
        if (typeof window !== 'undefined') {
            const container = document.getElementById('webrtc-audio-global');
            if (container) {
                const audios = container.querySelectorAll('audio');
                audios.forEach(audio => {
                    audio.muted = deafened.value;
                });
            }
        }

        console.log('[VoiceStore] Deafened:', deafened.value);
    }

    function clearVoiceState() {
        if (connected.value) {
            leaveVoiceChannel();
        }
        
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

    function isInVoiceChannel(channelId) {
        return currentChannelId.value === channelId && connected.value;
    }

    async function applyOutputDevice() {
        if (sfuComposable.value && sfuComposable.value.applyOutputDeviceToAll) {
            await sfuComposable.value.applyOutputDeviceToAll();
        }
    }

    // Directory helpers
    function upsertUserProfile(profile) {
        if (profile && profile.id) {
            const prev = userDirectory.value.get(profile.id) || {};
            const merged = { ...prev, ...profile };
            userDirectory.value.set(profile.id, merged);
            // Update live connected user if present
            const cu = connectedUsers.value.get(profile.id)
            if (cu) {
                connectedUsers.value.set(profile.id, { ...cu, ...merged })
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
    };
});
