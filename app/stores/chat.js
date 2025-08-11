import { defineStore } from "pinia";
import BackgroundWorker from '../utils/BackgroundWorker';
import { useRuntimeConfig } from '#app';
import { useAuthStore } from './auth';

export const useChatStore = defineStore('chat', () => {
    const messages = ref([]);
    const loading = ref(false);
    const error = ref(null);
    const ws = ref(null);
    const connected = ref(false);
    const currentChannelId = ref(null);
    const currentChannelName = ref(null);
    const currentRoomId = ref(null);
    const onlineUsers = ref([]);
    const typingUsers = ref([]);
    const config = useRuntimeConfig();
    let reconnectInterval = null;
    let reconnectTimer = null;
    let pingInterval = null;

    
    if (process.client && 'serviceWorker' in navigator) {
        console.log('[ChatStore] Service Worker supported');
        
        
        navigator.serviceWorker.getRegistration().then(reg => {
            if (reg) {
                console.log('[ChatStore] Service Worker registered:', reg);
                console.log('[ChatStore] SW active:', !!reg.active);
                console.log('[ChatStore] SW controller:', !!navigator.serviceWorker.controller);
            } else {
                console.log('[ChatStore] No Service Worker registration found');
            }
        });

        navigator.serviceWorker.addEventListener('message', event => {
            console.log('[ChatStore] Received SW message:', event.data);
            if (event.data.type === 'BACKGROUND_SYNC_SUCCESS') {
                handleBackgroundSyncSuccess(event.data.pendingId);
            }
        });

        
        const sendConfigToSW = () => {
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                    type: 'SET_API_CONFIG',
                    config: {
                        apiPath: config.public.apiPath
                    }
                });
                console.log('[ChatStore] Sent API config to SW:', config.public.apiPath);
            } else {
                console.log('[ChatStore] No SW controller available');
            }
        };

        
        if (navigator.serviceWorker.controller) {
            sendConfigToSW();
        }

        
        navigator.serviceWorker.ready.then(reg => {
            console.log('[ChatStore] Service Worker ready:', reg);
            if (reg.active) {
                reg.active.postMessage({
                    type: 'SET_API_CONFIG',
                    config: {
                        apiPath: config.public.apiPath
                    }
                });
                console.log('[ChatStore] Sent API config to SW (ready):', config.public.apiPath);
            }
        });

        
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            console.log('[ChatStore] SW controller changed, sending config');
            sendConfigToSW();
        });

        
        window.addEventListener('online', () => {
            console.log('[ChatStore] Came back online, triggering background sync');
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                
                sendConfigToSW();
                
                
                setTimeout(() => {
                    console.log('[ChatStore] Attempting sync via multiple methods...');
                    
                    
                    navigator.serviceWorker.ready.then(reg => {
                        if (reg.sync) {
                            console.log('[ChatStore] Using Background Sync API');
                            reg.sync.register('chat-sync');
                        }
                    });
                    
                    
                    if (navigator.serviceWorker.controller) {
                        console.log('[ChatStore] Sending FORCE_SYNC message');
                        navigator.serviceWorker.controller.postMessage({
                            type: 'FORCE_SYNC'
                        });
                    }
                }, 500);
            }
        });
    }

    
    function triggerManualSync() {
        console.log('[ChatStore] Manual sync triggered');
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'SET_API_CONFIG',
                config: {
                    apiPath: config.public.apiPath
                }
            });
            
            setTimeout(() => {
                navigator.serviceWorker.controller.postMessage({
                    type: 'FORCE_SYNC'
                });
            }, 100);
        }
    }

    async function connectToChannel(channelId, channelName = null, roomId = null) {
        disconnectFromChannel();
        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            currentChannelId.value = channelId;
            currentChannelName.value = channelName;
            currentRoomId.value = roomId;
            await fetchMessages(channelId);

            
            const websocketPath = config.public.websocketPath;
            const wsUrl = `${websocketPath}/chat/socket?channelId=${channelId}&auth=${encodeURIComponent(userData.id)}`;
            ws.value = new WebSocket(wsUrl);

            ws.value.onopen = () => {
                connected.value = true;
                console.log(`[ChatStore] Connected to channel ${channelId}`);
                if (reconnectInterval) {
                    clearInterval(reconnectInterval);
                    reconnectInterval = null;
                }
                
                if (pingInterval) clearInterval(pingInterval);
                pingInterval = setInterval(() => {
                    sendPing();
                }, 30000);
                
                if (currentChannelId.value) {
                    fetchMessages(currentChannelId.value);
                }
            };

            ws.value.onmessage = handleWebSocketMessage;

            ws.value.onclose = () => {
                connected.value = false;
                console.log('[ChatStore] WebSocket connection closed');
                
                if (pingInterval) {
                    clearInterval(pingInterval);
                    pingInterval = null;
                }
                
                if (!reconnectInterval && currentChannelId.value) {
                    reconnectInterval = setInterval(() => {
                        if (!connected.value && currentChannelId.value) {
                            console.log('[ChatStore] Attempting to reconnect...');
                            connectToChannel(currentChannelId.value, currentChannelName.value, currentRoomId.value);
                        }
                    }, 7000);
                }
            };

            ws.value.onerror = (error) => {
                console.error('[ChatStore] WebSocket error:', error);
                error.value = 'WebSocket connection failed';
            };

            
            if (typeof window !== 'undefined') {
                try {
                    const { usePushSubscription } = await import('../composables/usePushSubscription')
                    const { updateSubscription, isSupported, isSubscribed } = usePushSubscription()
                    if (isSupported.value && !isSubscribed.value) {
                        await updateSubscription()
                        console.log('[ChatStore] Push subscription updated (global)')
                    }
                } catch (err) {
                    console.warn('[ChatStore] Failed to update push subscription:', err)
                }
            }
        } catch (err) {
            error.value = err.message;
            console.error('[ChatStore] Error connecting to channel:', err);
        }
    }

    function disconnectFromChannel() {
        if (ws.value) {
            ws.value.close();
            ws.value = null;
        }
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }
        if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
        }
        connected.value = false;
        currentChannelId.value = null;
        currentChannelName.value = null;
        currentRoomId.value = null;
        messages.value = [];
        onlineUsers.value = [];
        typingUsers.value = [];
        console.log('[ChatStore] Disconnected from channel and cleared state');
    }



    
    async function handleWebSocketMessage(event) {
        try {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'connected':
                    console.log('[ChatStore] Connection confirmed:', data.data);
                    break;
                case 'new_message':
                    console.log('[ChatStore] New message received:', data.data);
                    const existingMessage = messages.value.find(msg => msg.id === data.data.id);
                    if (existingMessage) {
                        console.log('[ChatStore] Duplicate message detected, skipping:', data.data.id);
                        break;
                    }
                    messages.value.push(data.data);
                    handleNewMessageNotification(data.data);
                    break;
                case 'message_updated':
                    console.log('[ChatStore] Message updated:', data.data);
                    updateMessageReadBy(data.data.id, data.data.read_by);
                    break;
                case 'message_deleted':
                    console.log('[ChatStore] Message deleted:', data.data);
                    removeMessage(data.data.id);
                    break;
                case 'channel_updated':
                    console.log('[ChatStore] Channel updated:', data.data);
                    break;
                case 'channel_deleted':
                    console.log('[ChatStore] Channel deleted:', data.data);
                    disconnectFromChannel();
                    break;
                case 'user_typing':
                    console.log('[ChatStore] User typing status:', data.data);
                    updateTypingStatus(data.data.userId, data.data.isTyping);
                    break;
                case 'pong':
                    break;
                case 'currentlyInChannel':
                case 'currentlyInRoom':
                    console.log('[ChatStore] Received online users update:', data.inRoom);
                    if (Array.isArray(data.inRoom)) {
                        onlineUsers.value = data.inRoom.map(u =>
                            typeof u === 'string' ? { id: u } : u
                        );
                        console.log('[ChatStore] Updated onlineUsers:', onlineUsers.value);
                    }
                    break;
                case 'user_joined':
                case 'user_left':
                    console.log('[ChatStore] User presence change:', data.type, data);
                    break;
                case 'participant_change':
                    console.log('[ChatStore] Participant change detected:', data);
                    await handleParticipantChange();
                    break;
                default:
                    console.log('[ChatStore] Unknown message type:', data.type, data);
            }
        } catch (err) {
            console.error('[ChatStore] Error parsing WebSocket message:', err, event.data);
        }
    }

    
    async function handleParticipantChange() {
        try {
            console.log('[ChatStore] Handling participant change - refreshing room data');
            
            if (currentRoomId.value) {
                const { useRoomsStore } = await import('./rooms');
                const roomsStore = useRoomsStore();
                
                // Refresh the entire rooms list to update member data
                await roomsStore.fetchRooms();
                console.log('[ChatStore] Room data refreshed after participant change');
            } else {
                console.log('[ChatStore] No current room ID, skipping room refresh');
            }
        } catch (error) {
            console.error('[ChatStore] Error handling participant change:', error);
        }
    }

    
    async function fetchMessages(channelId) {
        loading.value = true;
        error.value = null;
        
        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            const apiPath = config.public.apiPath;
            const response = await fetch(`${apiPath}/chat/messages?channelId=${channelId}`, {
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch messages: ${response.status}`);
            }

            const data = await response.json();
            console.log('[ChatStore] API messages response:', data);
            if (Array.isArray(data.messages)) {
                messages.value = data.messages;
            } else if (Array.isArray(data)) {
                messages.value = data;
            } else {
                messages.value = [];
            }
            console.log('[ChatStore] Assigned messages:', messages.value);

            
            try {
                const storageKey = `dspeak2_unread_message_ids_${userData.id}`;
                let unreadIds = [];
                try {
                    unreadIds = JSON.parse(localStorage.getItem(storageKey)) || [];
                } catch (e) {
                    unreadIds = [];
                }
                
                const alreadyReadIds = messages.value
                    .filter(msg => Array.isArray(msg.read_by) && msg.read_by.includes(userData.id))
                    .map(msg => msg.id);
                const filteredUnread = unreadIds.filter(id => !alreadyReadIds.includes(id));
                if (filteredUnread.length !== unreadIds.length) {
                    localStorage.setItem(storageKey, JSON.stringify(filteredUnread));
                }
            } catch (e) {
                console.warn('[ChatStore] Failed to reconcile local unread IDs:', e);
            }
        } catch (err) {
            error.value = err.message;
            console.error('[ChatStore] Error fetching messages:', err);
        } finally {
            loading.value = false;
        }
    }

    
    async function sendMessage(channelId, content) {
        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            
            const pendingMessage = {
                id: `pending_${Date.now()}`,
                content,
                room_channel: channelId,
                sender: {
                    id: userData.id,
                    name: userData.name || 'You',
                    email: userData.email
                },
                created: new Date().toISOString(),
                read_by: [userData.id],
                status: 'pending' 
            };

            
            messages.value.push(pendingMessage);

            
            if (!navigator.onLine) {
                
                const queuedMessage = {
                    id: Date.now(),
                    channelId,
                    content,
                    sender: userData.id,
                    pendingId: pendingMessage.id 
                };
                await BackgroundWorker.enqueueMessage(queuedMessage);
                if ('serviceWorker' in navigator && 'SyncManager' in window) {
                    navigator.serviceWorker.ready.then(reg => {
                        
                        if (reg.active) {
                            reg.active.postMessage({
                                type: 'SET_API_CONFIG',
                                config: {
                                    apiPath: config.public.apiPath
                                }
                            });
                        }
                        reg.sync.register('chat-sync');
                    });
                }
                return { status: 'queued-offline', id: queuedMessage.id };
            }

            try {
                const apiPath = config.public.apiPath;
                const response = await fetch(`${apiPath}/chat/message`, {
                    method: 'POST',
                    headers: {
                        'Authorization': userData.id,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        channelId,
                        content
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const message = await response.json();
                
                
                const pendingIndex = messages.value.findIndex(msg => msg.id === pendingMessage.id);
                if (pendingIndex !== -1) {
                    messages.value.splice(pendingIndex, 1);
                }
                
                return message;
            } catch (fetchError) {
                
                const queuedMessage = {
                    id: Date.now(),
                    channelId,
                    content,
                    sender: userData.id,
                    pendingId: pendingMessage.id
                };
                await BackgroundWorker.enqueueMessage(queuedMessage);
                if ('serviceWorker' in navigator && 'SyncManager' in window) {
                    navigator.serviceWorker.ready.then(reg => {
                        reg.sync.register('chat-sync');
                    });
                }
                return { status: 'queued-error', error: fetchError.message };
            }
        } catch (err) {
            error.value = err.message;
            console.error('[ChatStore] Error sending message:', err);
            throw err;
        }
    }

    
    async function markMessageAsRead(messageId) {
        
        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            
            const storageKey = `dspeak2_unread_message_ids_${userData.id}`;
            let unreadIds = [];
            try {
                unreadIds = JSON.parse(localStorage.getItem(storageKey)) || [];
            } catch (e) {
                unreadIds = [];
            }
            
            if (!unreadIds.includes(messageId)) {
                unreadIds.push(messageId);
                localStorage.setItem(storageKey, JSON.stringify(unreadIds));
            }
        } catch (err) {
            error.value = err.message;
            console.error('[ChatStore] Error batching message as read:', err);
            throw err;
        }
    }

    
    function startReadBatchSync() {
        setInterval(async () => {
            try {
                const authStore = useAuthStore();
                const userData = authStore.getUserData();
                if (!userData || !userData.id) return;
                const storageKey = `dspeak2_unread_message_ids_${userData.id}`;
                let unreadIds = [];
                try {
                    unreadIds = JSON.parse(localStorage.getItem(storageKey)) || [];
                } catch (e) {
                    unreadIds = [];
                }
                if (unreadIds.length === 0) return;

                const apiPath = config.public.apiPath;
                const response = await fetch(`${apiPath}/chat/read`, {
                    method: 'POST',
                    headers: {
                        'Authorization': userData.id,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        messageIds: unreadIds
                    })
                });
                if (response.ok) {
                    
                    localStorage.setItem(storageKey, JSON.stringify([]));
                } else {
                    
                    console.warn('[ChatStore] Failed to batch mark messages as read:', response.status);
                }
            } catch (err) {
                console.error('[ChatStore] Error in batch read sync:', err);
            }
    }, 5000); 
    }

    
    startReadBatchSync();

    
    function sendTypingIndicator(isTyping) {
        console.log('[ChatStore] Sending typing indicator:', { isTyping, connected: connected.value });
        if (ws.value && connected.value) {
            const message = {
                type: 'typing',
                isTyping
            };
            console.log('[ChatStore] Sending typing message:', message);
            ws.value.send(JSON.stringify(message));
        } else {
            console.log('[ChatStore] Cannot send typing indicator - not connected');
        }
    }

    
    function sendPing() {
        if (ws.value && connected.value) {
            ws.value.send(JSON.stringify({
                type: 'ping'
            }));
        }
    }

    
    function updateMessageReadBy(messageId, readBy) {
        const messageIndex = messages.value.findIndex(msg => msg.id === messageId);
        if (messageIndex !== -1) {
            messages.value[messageIndex].read_by = readBy;
        }
    }

    function removeMessage(messageId) {
        const messageIndex = messages.value.findIndex(msg => msg.id === messageId);
        if (messageIndex !== -1) {
            messages.value.splice(messageIndex, 1);
        }
    }

    function updateTypingStatus(userId, isTyping) {
        const authStore = useAuthStore();
        const userData = authStore.getUserData();
        
        console.log('[ChatStore] Typing status update:', { userId, isTyping, currentUser: userData?.id });
        
        
        if (userData && userId === userData.id) {
            console.log('[ChatStore] Ignoring typing status for current user');
            return;
        }

        if (isTyping) {
            if (!typingUsers.value.includes(userId)) {
                console.log('[ChatStore] Adding user to typing list:', userId);
                typingUsers.value.push(userId);
            }
        } else {
            const index = typingUsers.value.indexOf(userId);
            if (index !== -1) {
                console.log('[ChatStore] Removing user from typing list:', userId);
                typingUsers.value.splice(index, 1);
            }
        }
        
        console.log('[ChatStore] Current typing users:', typingUsers.value);
    }

    
    function clearChat() {
        disconnectFromChannel();
        messages.value = [];
        error.value = null;
        onlineUsers.value = [];
        typingUsers.value = [];
    }

    
    async function handleNewMessageNotification(message) {
        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            
            
            if (userData && message.sender.id === userData.id) {
                console.log('[ChatStore] Skipping notification for own message');
                return;
            }
            
            console.log('[ChatStore] Checking notification conditions...');
            console.log('[ChatStore] Page visibility - hidden:', document.hidden, 'focused:', document.hasFocus());
            
            
            const notificationManager = (await import('../utils/notificationManager')).default;
            
            console.log('[ChatStore] Notification settings:');
            console.log('  - Supported:', notificationManager.isSupported);
            console.log('  - Enabled:', notificationManager.isEnabled);
            console.log('  - Permission:', notificationManager.permission);
            console.log('  - Should show:', notificationManager.shouldShowNotification());
            
            
            if (notificationManager.isSupported && notificationManager.isEnabled) {
                console.log('[ChatStore] Attempting to show notification for message:', message);
                
                const notification = notificationManager.showMessageNotification(message, currentChannelName.value);
                
                
                if (notification) {
                    console.log('[ChatStore] Notification created successfully');
                    notification.onclick = () => {
                        console.log('[ChatStore] Notification clicked - focusing window');
                        window.focus();
                        notification.close();
                    };
                } else {
                    console.log('[ChatStore] Notification creation returned null');
                }
            } else {
                console.log('[ChatStore] Notification conditions not met - supported:', notificationManager.isSupported, 'enabled:', notificationManager.isEnabled);
            }
        } catch (error) {
            console.error('[ChatStore] Error showing notification:', error);
        }
    }

    
    function handleBackgroundSyncSuccess(pendingId) {
        const pendingIndex = messages.value.findIndex(msg => msg.id === pendingId);
        if (pendingIndex !== -1) {
            messages.value.splice(pendingIndex, 1);
        }
    }

    return {
        messages,
        loading,
        error,
        connected,
        currentChannelId,
        currentChannelName,
        currentRoomId,
        onlineUsers,
        typingUsers,
        connectToChannel,
        disconnectFromChannel,
        fetchMessages,
        sendMessage,
        markMessageAsRead,
        sendTypingIndicator,
        sendPing,
        clearChat,
        handleBackgroundSyncSuccess,
        triggerManualSync
    };
});
