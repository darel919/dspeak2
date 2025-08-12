import { defineStore } from "pinia";
import { useAuthStore } from './auth';

export const useVoiceStore = defineStore('voice', () => {
    const currentChannelId = ref(null);
    const currentRoomId = ref(null);
    const connectedUsers = ref(new Map());
    const micMuted = ref(true);
    const deafened = ref(false);
    const connecting = ref(false);
    const connected = ref(false);
    const error = ref(null);

    const sfuComposable = ref(null);

    function setCurrentChannel(channelId) {
        currentChannelId.value = channelId;
        
        // Get room ID from channel
        if (typeof window !== 'undefined') {
            import('~/stores/channels').then(({ useChannelsStore }) => {
                const channelsStore = useChannelsStore();
                const channel = channelsStore.getChannelById(channelId);
                if (channel) {
                    currentRoomId.value = channel.room_id;
                }
            });
        }
    }

    function addConnectedUser(userId, userInfo) {
        connectedUsers.value.set(userId, {
            id: userId,
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
            connected.value = true;

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

            console.log('[VoiceStore] Successfully joined voice channel:', channelId);

            // Show success notification
            if (typeof window !== 'undefined') {
                const { useToast } = await import('~/composables/useToast');
                const { success } = useToast();
                success('Connected to voice channel');
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
            micMuted.value = true;
            deafened.value = false;
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
        micMuted.value = true;
        deafened.value = false;
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

    return {
        currentChannelId: readonly(currentChannelId),
        currentRoomId: readonly(currentRoomId),
        connectedUsers: readonly(connectedUsers),
        micMuted: readonly(micMuted),
        deafened: readonly(deafened),
        connecting: readonly(connecting),
        connected: readonly(connected),
        error: readonly(error),
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
    };
});
