import { defineStore } from "pinia";
import { useAuthStore } from './auth';


export const useVoiceStore = defineStore('voice', () => {
    const currentChannelId = ref(null);
    const currentRoomId = ref(null);
    const connectedUsers = ref(new Map());
    // Cached user profiles keyed by userId, populated from room data
    const userDirectory = ref(new Map());
    const micMuted = ref(true);
    const deafened = ref(false);
    const connecting = ref(false);
    const connected = ref(false);
    const error = ref(null);

    const sfuComposable = ref(null);

    // Initialize persisted preferences
    if (typeof window !== 'undefined') {
        try {
            const persistedMic = localStorage.getItem('voice.micMuted');
            if (persistedMic !== null) micMuted.value = persistedMic === 'true';
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
    }

    function removeConnectedUser(userId) {
        connectedUsers.value.delete(userId);
    }

    function updateUserSpeaking(userId, speaking) {
        const user = connectedUsers.value.get(userId);
        if (user) {
            user.speaking = speaking;
        }
    }

    function updateUserMuted(userId, muted) {
        const user = connectedUsers.value.get(userId);
        if (user) {
            user.muted = muted;
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
                    if (!persistedMic) {
                        // Attempt to start mic if unmuted and transports ready
                        try {
                            if (sfuComposable.value.transportReady) {
                                await sfuComposable.value.startAudioProduction();
                            }
                        } catch (err) {
                            // keep state; error will show via toast
                        }
                    }
                } else {
                    // If permission is denied, keep mic muted
                    if (micPermission === 'denied') {
                        micMuted.value = true;
                    } else if (micPermission === 'granted') {
                        micMuted.value = false;
                    } else {
                        // If prompt, ask for permission now
                        try {
                            await navigator.mediaDevices.getUserMedia({ audio: true });
                            micMuted.value = false;
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

    function isUserConnected(userId) {
        return connectedUsers.value.has(userId);
    }

    function getUserById(userId) {
        return connectedUsers.value.get(userId);
    }

    function isInVoiceChannel(channelId) {
        return currentChannelId.value === channelId && connected.value;
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
        isUserConnected,
        getUserById,
        isInVoiceChannel
    , upsertUserProfile
    , getUserProfile
    };
});
