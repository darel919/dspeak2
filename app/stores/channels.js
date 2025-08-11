import { defineStore } from "pinia";
import { useRuntimeConfig } from '#app';
import { useAuthStore } from './auth';

export const useChannelsStore = defineStore('channels', () => {
    const channels = ref([]);
    const loading = ref(false);
    const error = ref(null);
    const currentChannelId = ref(null);
    const config = useRuntimeConfig();

    // Get all channels for a specific room
    async function fetchChannels(roomId) {
        if (!roomId) {
            throw new Error('Room ID is required');
        }

        loading.value = true;
        error.value = null;

        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            const apiPath = config.public.apiPath;
            const response = await fetch(`${apiPath}/channel/?roomId=${roomId}`, {
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch channels: ${response.status}`);
            }

            const data = await response.json();
            channels.value = Array.isArray(data) ? data : [];
            console.log('[ChannelsStore] Fetched channels:', channels.value);
            
            return channels.value;
        } catch (err) {
            error.value = err.message;
            console.error('[ChannelsStore] Error fetching channels:', err);
            throw err;
        } finally {
            loading.value = false;
        }
    }

    // Create a new channel
    async function createChannel(roomId, channelData) {
        if (!roomId) {
            throw new Error('Room ID is required');
        }

        if (!channelData.name || !channelData.name.trim()) {
            throw new Error('Channel name is required');
        }

        loading.value = true;
        error.value = null;

        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            const apiPath = config.public.apiPath;
            const response = await fetch(`${apiPath}/channel/`, {
                method: 'POST',
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    roomId,
                    name: channelData.name.trim(),
                    desc: channelData.desc || '',
                    isMedia: channelData.isMedia || false,
                    audio_bitrate: channelData.audio_bitrate || null
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to create channel: ${response.status} ${errorText}`);
            }

            const newChannel = await response.json();
            console.log('[ChannelsStore] Created channel:', newChannel);
            
            // Refresh channels list
            await fetchChannels(roomId);
            
            return newChannel;
        } catch (err) {
            error.value = err.message;
            console.error('[ChannelsStore] Error creating channel:', err);
            throw err;
        } finally {
            loading.value = false;
        }
    }

    // Edit an existing channel
    async function editChannel(channelId, channelData) {
        if (!channelId) {
            throw new Error('Channel ID is required');
        }

        loading.value = true;
        error.value = null;

        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            const apiPath = config.public.apiPath;
            const response = await fetch(`${apiPath}/channel/`, {
                method: 'PUT',
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    channelId,
                    name: channelData.name?.trim(),
                    desc: channelData.desc,
                    audio_bitrate: channelData.audio_bitrate
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to edit channel: ${response.status} ${errorText}`);
            }

            console.log('[ChannelsStore] Edited channel:', channelId);
            
            // Update local channel data
            const channelIndex = channels.value.findIndex(c => c.id === channelId);
            if (channelIndex !== -1) {
                channels.value[channelIndex] = { ...channels.value[channelIndex], ...channelData };
            }
            
            return true;
        } catch (err) {
            error.value = err.message;
            console.error('[ChannelsStore] Error editing channel:', err);
            throw err;
        } finally {
            loading.value = false;
        }
    }

    // Delete a channel
    async function deleteChannel(channelId) {
        if (!channelId) {
            throw new Error('Channel ID is required');
        }

        loading.value = true;
        error.value = null;

        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            const apiPath = config.public.apiPath;
            const response = await fetch(`${apiPath}/channel/`, {
                method: 'DELETE',
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    channelId
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to delete channel: ${response.status} ${errorText}`);
            }

            console.log('[ChannelsStore] Deleted channel:', channelId);
            
            // Remove from local channels
            channels.value = channels.value.filter(c => c.id !== channelId);
            
            // Clear current channel if it was deleted
            if (currentChannelId.value === channelId) {
                currentChannelId.value = null;
            }
            
            return true;
        } catch (err) {
            error.value = err.message;
            console.error('[ChannelsStore] Error deleting channel:', err);
            throw err;
        } finally {
            loading.value = false;
        }
    }

    // Join a channel
    async function joinChannel(channelId) {
        if (!channelId) {
            throw new Error('Channel ID is required');
        }

        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            const apiPath = config.public.apiPath;
            const response = await fetch(`${apiPath}/channel/join`, {
                method: 'POST',
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    channelId
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to join channel: ${response.status} ${errorText}`);
            }

            console.log('[ChannelsStore] Joined channel:', channelId);
            
            // Update local channel data to reflect user is in room
            const channelIndex = channels.value.findIndex(c => c.id === channelId);
            if (channelIndex !== -1) {
                const channel = channels.value[channelIndex];
                if (!channel.inRoom.includes(userData.id)) {
                    channel.inRoom.push(userData.id);
                }
            }
            
            return true;
        } catch (err) {
            console.error('[ChannelsStore] Error joining channel:', err);
            throw err;
        }
    }

    // Leave a channel
    async function leaveChannel(channelId) {
        if (!channelId) {
            throw new Error('Channel ID is required');
        }

        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            const apiPath = config.public.apiPath;
            const response = await fetch(`${apiPath}/channel/leave`, {
                method: 'POST',
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    channelId
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to leave channel: ${response.status} ${errorText}`);
            }

            console.log('[ChannelsStore] Left channel:', channelId);
            
            // Update local channel data to reflect user left room
            const channelIndex = channels.value.findIndex(c => c.id === channelId);
            if (channelIndex !== -1) {
                const channel = channels.value[channelIndex];
                channel.inRoom = channel.inRoom.filter(userId => userId !== userData.id);
            }
            
            return true;
        } catch (err) {
            console.error('[ChannelsStore] Error leaving channel:', err);
            throw err;
        }
    }

    // Get channel details
    async function getChannelDetails(channelId) {
        if (!channelId) {
            throw new Error('Channel ID is required');
        }

        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            const apiPath = config.public.apiPath;
            const response = await fetch(`${apiPath}/channel/details?id=${channelId}`, {
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch channel details: ${response.status}`);
            }

            const channelDetails = await response.json();
            console.log('[ChannelsStore] Fetched channel details:', channelDetails);
            
            return channelDetails;
        } catch (err) {
            console.error('[ChannelsStore] Error fetching channel details:', err);
            throw err;
        }
    }

    // Get unread message counts for all accessible channels
    async function getUnreadCounts() {
        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            const apiPath = config.public.apiPath;
            const response = await fetch(`${apiPath}/chat/unread`, {
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch unread counts: ${response.status}`);
            }

            const unreadCounts = await response.json();
            console.log('[ChannelsStore] Fetched unread counts:', unreadCounts);
            
            return unreadCounts;
        } catch (err) {
            console.error('[ChannelsStore] Error fetching unread counts:', err);
            throw err;
        }
    }

    // Helper functions
    function getChannelById(channelId) {
        return channels.value.find(c => c.id === channelId);
    }

    function getTextChannels() {
        return channels.value.filter(c => !c.isMedia);
    }

    function getMediaChannels() {
        return channels.value.filter(c => c.isMedia);
    }

    function clearChannels() {
        channels.value = [];
        currentChannelId.value = null;
        error.value = null;
    }

    return {
        channels: readonly(channels),
        loading: readonly(loading),
        error: readonly(error),
        currentChannelId,
        fetchChannels,
        createChannel,
        editChannel,
        deleteChannel,
        joinChannel,
        leaveChannel,
        getChannelDetails,
        getUnreadCounts,
        getChannelById,
        getTextChannels,
        getMediaChannels,
        clearChannels
    };
});
