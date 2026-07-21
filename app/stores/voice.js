import { defineStore } from "pinia";
import { useAuthStore } from './auth';
import { useRoomsStore } from './rooms';
import { useSettingsStore } from './settings';
import { useChannelsStore } from './channels';

export const useVoiceStore = defineStore('voice', () => {
    const currentChannelId = ref(null);
    const currentRoomId = ref(null);
    const connectedUsers = ref(new Map());

    const userVolumes = ref({});
    const trackVolumes = ref({});

    const userDirectory = ref(new Map());
    const micMuted = ref(true);
    const deafened = ref(false);
    const connecting = ref(false);
    const connected = ref(false);
    const error = ref(null);
    const connectedAt = ref(null);
    const cameraEnabled = ref(false);
    const screenSharing = ref(false);
    const systemAudioSharing = ref(false);
    const settingsStore = useSettingsStore();
    const channelsStore = useChannelsStore();
    const sharedAudioVolume = computed(() => settingsStore.sharedAudioVolume);
    const sharedAudioStats = computed(() => sfuComposable.value?.sharedAudioStats || { kbps: 0, level: 0, dbfs: -60 });
    const effectiveSystemAudioBitrate = computed(() => {
        const requested = Number(settingsStore.systemAudioBitrate) || 128;
        const channelLimit = Number(channelsStore.getChannelById(currentChannelId.value)?.audio_bitrate);
        return Number.isFinite(channelLimit) && channelLimit > 0 ? Math.min(requested, channelLimit) : requested;
    });

    const sfuComposable = ref(null);

    let stopIceWatcher = null;


    if (typeof window !== 'undefined') {
        try {
            const persistedMic = localStorage.getItem('voice.micMuted');
            if (persistedMic !== null) micMuted.value = persistedMic === 'true';

            const persistedVolumes = localStorage.getItem('voice.userVolumes');
            if (persistedVolumes) {
                try {
                    const parsed = JSON.parse(persistedVolumes);
                    if (parsed && typeof parsed === 'object') {
                        Object.assign(userVolumes.value, parsed);
                    }
                } catch (_) { /* ignore */ }
            }
            const persistedTrackVolumes = localStorage.getItem('voice.trackVolumes');
            if (persistedTrackVolumes) Object.assign(trackVolumes.value, JSON.parse(persistedTrackVolumes));
        } catch (_) { /* noop */ }
    }


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
        watch(trackVolumes, (vols) => {
            try { localStorage.setItem('voice.trackVolumes', JSON.stringify(vols)) } catch (_) { /* noop */ }
        }, { deep: true, immediate: true })
    }


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

        });
    }

    function setCurrentChannel(channelId) {
        currentChannelId.value = channelId;


        if (typeof window !== 'undefined') {
            import('~/stores/channels').then(({ useChannelsStore }) => {
                const channelsStore = useChannelsStore();
                const channel = channelsStore.getChannelById(channelId);
                if (channel) {

                    currentRoomId.value = channel.room || channel.room_id || channel.roomId || null;
                }
            });
        }
    }


    async function leaveVoiceChannel() {
        try {

            if (sfuComposable.value && typeof sfuComposable.value.stopAudioProduction === 'function') {
                try { await sfuComposable.value.stopAudioProduction(); } catch (_) { /* noop */ }
            }
            try { sfuComposable.value?.stopVideoProduction?.('camera'); } catch (_) { /* noop */ }
            try { sfuComposable.value?.stopVideoProduction?.('screen'); } catch (_) { /* noop */ }
            try { sfuComposable.value?.stopSystemAudioProduction?.(); } catch (_) { /* noop */ }


            if (sfuComposable.value && typeof sfuComposable.value.disconnect === 'function') {
                try { await sfuComposable.value.disconnect(); } catch (_) { /* noop */ }
            }
        } catch (err) {

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
            cameraEnabled.value = false;
            screenSharing.value = false;
            systemAudioSharing.value = false;
        }
    }


    function upsertUserProfile(profile) {
        if (!profile || !profile.id) return;
        const prev = userDirectory.value.get(profile.id) || {};
        const merged = { ...prev, ...profile };
        userDirectory.value.set(profile.id, merged);

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

    connectedUsers.value = new Map(connectedUsers.value);

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

    }
    function setUserVolume(userId, volume) {
        const v = Math.max(0, Math.min(1, Number(volume)));
        userVolumes.value[userId] = v;

        if (typeof window !== 'undefined') {
            try {

                const audio = document.getElementById(`audio-${userId}`);
                if (audio) {
                    audio.volume = v;
                }

                if (sfuComposable.value && typeof sfuComposable.value.applyVolumeForUser === 'function') {
                    sfuComposable.value.applyVolumeForUser(userId, v);
                }
            } catch (_) { /* noop */ }
        }
    }
    function getUserVolume(userId) {
        return typeof userVolumes.value[userId] !== 'undefined' ? userVolumes.value[userId] : 1.0;
    }

    function setTrackVolume(userId, source, volume) {
        const v = Math.max(0, Math.min(1, Number(volume)));
        trackVolumes.value[`${userId}:${source}`] = v;
        if (source === 'audio') userVolumes.value[userId] = v;
        sfuComposable.value?.applyVolumeForTrack?.(userId, source, v);
    }

    function getTrackVolume(userId, source) {
        const value = trackVolumes.value[`${userId}:${source}`];
        if (typeof value !== 'undefined') return value;
        return source === 'audio' ? getUserVolume(userId) : 1.0;
    }

    function updateUserSpeaking(userId, speaking) {




        let user = connectedUsers.value.get(userId);
        if (!user) {
            try {

                const auth = useAuthStore && useAuthStore().getUserData ? useAuthStore().getUserData() : null;
                if (auth && String(auth.id) === String(userId)) {

                    addConnectedUser(userId, { id: userId });
                    user = connectedUsers.value.get(userId);
                }
            } catch (_) {

            }
        }
    if (!user) return;

    connectedUsers.value.set(userId, { ...user, speaking });
    connectedUsers.value = new Map(connectedUsers.value);
    }

    function updateUserMuted(userId, muted) {
        const user = connectedUsers.value.get(userId);
        if (user) {
            connectedUsers.value.set(userId, { ...user, muted, ...(muted ? { speaking: false } : {}) });
            connectedUsers.value = new Map(connectedUsers.value);
        }
    }

    async function ensureMicrophonePermission() {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            throw new Error('Microphone access is not supported by this browser');
        }

        if (navigator.permissions?.query) {
            try {
                const status = await navigator.permissions.query({ name: 'microphone' });
                if (status.state === 'granted') return;
                if (status.state === 'denied') {
                    throw new Error('Microphone permission is required to join the room');
                }
            } catch (err) {


                if (err?.message === 'Microphone permission is required to join the room') {
                    throw err;
                }
            }
        }

        let permissionStream;
        try {
            permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
                throw new Error('Microphone permission is required to join the room');
            }
            throw new Error(err?.message || 'Unable to access the microphone');
        } finally {
            permissionStream?.getTracks().forEach(track => track.stop());
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


            await ensureMicrophonePermission();

                if (connected.value && currentChannelId.value !== channelId) {
                await leaveVoiceChannel();
            }

            const { useMediasoupSfu } = await import('~/composables/useMediasoupSfu');
            sfuComposable.value = useMediasoupSfu();

            if (stopIceWatcher) { try { stopIceWatcher(); } catch (_) { /* noop */ } stopIceWatcher = null; }
            stopIceWatcher = watch(
                () => sfuComposable.value && sfuComposable.value.iceConnectedBoth,
                (v) => {

                    connected.value = !!v;
                }
            );

            await sfuComposable.value.connect(channelId);
            setCurrentChannel(channelId);


            if (!sfuComposable.value.error) {

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


                while (!sfuComposable.value.transportReady) {
                    await new Promise(res => setTimeout(res, 50));
                }


                await new Promise(res => setTimeout(res, 200));


                const { useSettingsStore } = await import('~/stores/settings');
                const settingsStore = useSettingsStore();
                const isBroadcast = settingsStore.broadcastMode;
                const timeoutMs = 45000;
                const startTime = Date.now();
                let connectedOk = false;

                while (Date.now() - startTime < timeoutMs) {

                    if (sfuComposable.value) {
                        try {

                            const remoteCount = sfuComposable.value.remoteProducersCount ?? -1;
                            const roomUsers = sfuComposable.value.lastInRoom ?? [];

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


                if (!micMuted.value) {
                    try {
                        await sfuComposable.value.startAudioProduction();
                    } catch (err) {

                        micMuted.value = true;
                    }
                } else if (sfuComposable.value.stopAudioProduction) {
                    try { await sfuComposable.value.stopAudioProduction() } catch (_) { /* noop */ }
                }

                connected.value = true;
                connectedAt.value = Date.now();

                joinedSuccessfully = true;
            } else {
                connected.value = false;
                error.value = sfuComposable.value.error;
                throw new Error(sfuComposable.value.error);
            }
        } catch (err) {
            console.error('[VoiceStore] Failed to join voice channel:', err);
            error.value = err.message;


            if (typeof window !== 'undefined') {
                const { useToast } = await import('~/composables/useToast');
                const { error: showError } = useToast();
                showError(`Failed to connect to voice: ${err.message}`);
            }

            throw err;
        }
        finally {

            connecting.value = false;



            if (!joinedSuccessfully) {
                try {

                    const remoteCount = sfuComposable.value?.remoteProducersCount ?? -1;
                    const roomUsers = sfuComposable.value?.lastInRoom ?? [];
                    if (remoteCount === 0 && Array.isArray(roomUsers) && roomUsers.length === 1) {

                    }
                } catch (err) {

                }
                connectedUsers.value.clear();
                connected.value = false;
                connectedAt.value = null;


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


    }

    async function toggleCamera() {
        if (!connected.value || !sfuComposable.value) return;
        try {
            if (cameraEnabled.value) {
                sfuComposable.value.stopVideoProduction('camera');
                cameraEnabled.value = false;
            } else {
                await sfuComposable.value.startVideoProduction('camera');
                cameraEnabled.value = true;
            }
            error.value = null;
        } catch (err) {
            error.value = err?.message || 'Unable to access the camera';
            throw err;
        }
    }

    async function toggleScreenShare() {
        if (!connected.value || !sfuComposable.value) return;
        try {
            if (screenSharing.value) {
                sfuComposable.value.stopVideoProduction('screen');
                screenSharing.value = false;
            } else {
                const producer = await sfuComposable.value.startVideoProduction('screen');
                screenSharing.value = true;
                const handleScreenShareEnded = () => {
                    screenSharing.value = false;
                };
                producer?.track?.addEventListener?.('ended', handleScreenShareEnded, { once: true });
                producer?.on?.('trackended', handleScreenShareEnded);
            }
            error.value = null;
        } catch (err) {
            if (err?.name !== 'NotAllowedError') error.value = err?.message || 'Unable to share the screen';
            screenSharing.value = false;
            throw err;
        }
    }

    async function toggleSystemAudioShare() {
        if (!connected.value || !sfuComposable.value) return;
        try {
            if (systemAudioSharing.value) {
                sfuComposable.value.stopSystemAudioProduction();
                systemAudioSharing.value = false;
            } else {
                const confirmed = typeof window === 'undefined' || window.confirm(
                    'Share system audio only?\n\n' +
                    'Your browser will show its regular screen-sharing dialog because that is how it gives access to system audio.\n\n' +
                    '1. Choose “Entire Screen” in the browser dialog.\n' +
                    '2. Make sure “Share audio” is enabled.\n\n' +
                    'Your screen video will not be shared—only the audio will be sent.'
                );
                if (!confirmed) return;
                const producer = await sfuComposable.value.startSystemAudioProduction();
                systemAudioSharing.value = true;
                const handleEnded = () => { systemAudioSharing.value = false; };
                producer?.track?.addEventListener?.('ended', handleEnded, { once: true });
                producer?.on?.('trackended', handleEnded);
            }
            error.value = null;
        } catch (err) {
            if (err?.name !== 'NotAllowedError') error.value = err?.message || 'Unable to share system audio';
            systemAudioSharing.value = false;
            throw err;
        }
    }

    function setSharedAudioVolume(value) {
        settingsStore.setSharedAudioVolume(value);
        sfuComposable.value?.setSharedAudioVolume?.(settingsStore.sharedAudioVolume);
    }

    async function setSystemAudioBitrate(value) {
        settingsStore.setSystemAudioBitrate(value);
        await sfuComposable.value?.setSystemAudioBitrate?.(settingsStore.systemAudioBitrate);
    }

    watch(
        () => channelsStore.getChannelById(currentChannelId.value)?.audio_bitrate,
        () => {
            if (connected.value) sfuComposable.value?.setSystemAudioBitrate?.(settingsStore.systemAudioBitrate).catch(() => {});
        }
    );

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


    if (typeof window !== 'undefined') {
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
    }

    return {
        currentChannelId: readonly(currentChannelId),
        currentRoomId: readonly(currentRoomId),
        connectedUsers: readonly(connectedUsers),
        micMuted: readonly(micMuted),
        deafened: readonly(deafened),
        connecting: readonly(connecting),
        connected: readonly(connected),
        error,
        connectedAt: readonly(connectedAt),
        cameraEnabled: readonly(cameraEnabled),
        screenSharing: readonly(screenSharing),
        systemAudioSharing: readonly(systemAudioSharing),
        sharedAudioVolume,
        sharedAudioStats,
        effectiveSystemAudioBitrate,
        sfuComposable: readonly(sfuComposable),
        joinVoiceChannel,
        leaveVoiceChannel,
        toggleMic,
        toggleDeafen,
        toggleCamera,
        toggleScreenShare,
        toggleSystemAudioShare,
        setSharedAudioVolume,
        setSystemAudioBitrate,
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
        setTrackVolume,
        getTrackVolume,
        userVolumes: readonly(userVolumes),
        trackVolumes: readonly(trackVolumes),
        applyOutputDevice
    }
});
