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
    const currentRoomId = ref(null);
    const onlineUsers = ref([]);
    const typingUsers = ref([]);
    const config = useRuntimeConfig();
    
    // Notification-related state
    const currentRoomName = ref(null);

    let reconnectInterval = null;
    let reconnectTimer = null;

    // Listen for Service Worker messages
    if (process.client && 'serviceWorker' in navigator) {
        console.log('[ChatStore] Service Worker supported');
        
        // Check current registration status
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

        // Send API configuration to Service Worker when ready
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

        // Send config immediately if SW is already controlling
        if (navigator.serviceWorker.controller) {
            sendConfigToSW();
        }

        // Also send config when SW becomes ready
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

        // Listen for SW controller changes
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            console.log('[ChatStore] SW controller changed, sending config');
            sendConfigToSW();
        });

        // Listen for online events to trigger sync
        window.addEventListener('online', () => {
            console.log('[ChatStore] Came back online, triggering background sync');
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                // First ensure config is sent
                sendConfigToSW();
                
                // Then trigger sync with multiple approaches
                setTimeout(() => {
                    console.log('[ChatStore] Attempting sync via multiple methods...');
                    
                    // Method 1: Background Sync API
                    navigator.serviceWorker.ready.then(reg => {
                        if (reg.sync) {
                            console.log('[ChatStore] Using Background Sync API');
                            reg.sync.register('chat-sync');
                        }
                    });
                    
                    // Method 2: Direct message to SW
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

    // Manual sync function for testing
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

    async function connectToRoom(roomId, roomName = null) {
        disconnectFromRoom();
        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            currentRoomId.value = roomId;
            currentRoomName.value = roomName;
            await fetchMessages(roomId);

            const websocketPath = config.public.websocketPath;
            const wsUrl = `${websocketPath}/chat/socket?roomId=${roomId}&auth=${encodeURIComponent(userData.id)}`;
            ws.value = new WebSocket(wsUrl);

            ws.value.onopen = () => {
                connected.value = true;
                console.log(`[ChatStore] Connected to room ${roomId}`);
                if (reconnectInterval) {
                    clearInterval(reconnectInterval);
                    reconnectInterval = null;
                }
                // Refetch messages after reconnect
                if (currentRoomId.value) {
                    fetchMessages(currentRoomId.value);
                }
            };

            ws.value.onmessage = handleWebSocketMessage;

            ws.value.onclose = () => {
                connected.value = false;
                console.log('[ChatStore] WebSocket connection closed');
                // Start reconnect attempts every 7 seconds
                if (!reconnectInterval && currentRoomId.value) {
                    reconnectInterval = setInterval(() => {
                        if (!connected.value && currentRoomId.value) {
                            console.log('[ChatStore] Attempting to reconnect...');
                            connectToRoom(currentRoomId.value, currentRoomName.value);
                        }
                    }, 7000);
                }
            };

            ws.value.onerror = (error) => {
                console.error('[ChatStore] WebSocket error:', error);
                error.value = 'WebSocket connection failed';
            };

        } catch (err) {
            error.value = err.message;
            console.error('[ChatStore] Error connecting to room:', err);
        }
    }

    function disconnectFromRoom() {
        if (ws.value) {
            ws.value.close();
            ws.value = null;
        }
        if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
        }
        connected.value = false;
        currentRoomId.value = null;
        currentRoomName.value = null;
        messages.value = [];
        onlineUsers.value = [];
        typingUsers.value = [];
        console.log('[ChatStore] Disconnected from room and cleared state');
    }

    // Handle incoming WebSocket messages
    function handleWebSocketMessage(event) {
        try {
            const data = JSON.parse(event.data);
            console.log('[ChatStore] Received WebSocket message:', data);
            
            switch (data.type) {
                case 'connected':
                    console.log('[ChatStore] Connection confirmed:', data.data);
                    break;
                    
                case 'new_message':
                    console.log('[ChatStore] New message received:', data.data);
                    
                    // Check for duplicates before adding
                    const existingMessage = messages.value.find(msg => msg.id === data.data.id);
                    if (existingMessage) {
                        console.log('[ChatStore] Duplicate message detected, skipping:', data.data.id);
                        break;
                    }
                    
                    messages.value.push(data.data);
                    
                    // Show notification for messages from other users
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
                    
                case 'room_updated':
                    console.log('[ChatStore] Room updated:', data.data);
                    // Handle room updates if needed
                    break;
                    
                case 'room_deleted':
                    console.log('[ChatStore] Room deleted:', data.data);
                    disconnectFromRoom();
                    break;
                    
                case 'user_typing':
                    console.log('[ChatStore] User typing status:', data.data);
                    updateTypingStatus(data.data.userId, data.data.isTyping);
                    break;
                    
                case 'pong':
                    console.log('[ChatStore] Pong received');
                    // Handle pong response
                    break;
                    
                default:
                    console.log('[ChatStore] Unknown message type:', data.type, data);
            }
        } catch (err) {
            console.error('[ChatStore] Error parsing WebSocket message:', err, event.data);
        }
    }

    // Fetch messages for a room
    async function fetchMessages(roomId) {
        loading.value = true;
        error.value = null;
        
        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            const apiPath = config.public.apiPath;
            const response = await fetch(`${apiPath}/chat/messages?roomId=${roomId}`, {
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
        } catch (err) {
            error.value = err.message;
            console.error('[ChatStore] Error fetching messages:', err);
        } finally {
            loading.value = false;
        }
    }

    // Send a message
    async function sendMessage(roomId, content) {
        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            // Create a pending message to show immediately in UI
            const pendingMessage = {
                id: `pending_${Date.now()}`,
                content,
                room: roomId,
                sender: {
                    id: userData.id,
                    name: userData.name || 'You',
                    email: userData.email
                },
                created: new Date().toISOString(),
                read_by: [userData.id],
                status: 'pending' // Mark as pending
            };

            // Add pending message to UI immediately
            messages.value.push(pendingMessage);

            // Check if we're offline
            if (!navigator.onLine) {
                // Queue message for background sync
                const queuedMessage = {
                    id: Date.now(),
                    roomId,
                    content,
                    sender: userData.id,
                    pendingId: pendingMessage.id // Link to pending message
                };
                await BackgroundWorker.enqueueMessage(queuedMessage);
                if ('serviceWorker' in navigator && 'SyncManager' in window) {
                    navigator.serviceWorker.ready.then(reg => {
                        // Ensure config is sent before registering sync
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
                        roomId,
                        content
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const message = await response.json();
                
                // Remove pending message and let the real message come via WebSocket
                const pendingIndex = messages.value.findIndex(msg => msg.id === pendingMessage.id);
                if (pendingIndex !== -1) {
                    messages.value.splice(pendingIndex, 1);
                }
                
                return message;
            } catch (fetchError) {
                // If failed, queue for background sync but keep pending message
                const queuedMessage = {
                    id: Date.now(),
                    roomId,
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

    // Mark message as read
    async function markMessageAsRead(messageId) {
        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            
            if (!userData || !userData.id) {
                throw new Error('User not authenticated');
            }

            const apiPath = config.public.apiPath;
            const response = await fetch(`${apiPath}/chat/read`, {
                method: 'POST',
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messageId
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to mark message as read: ${response.status}`);
            }

            return await response.json();
        } catch (err) {
            error.value = err.message;
            console.error('[ChatStore] Error marking message as read:', err);
            throw err;
        }
    }

    // Send typing indicator
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

    // Send ping
    function sendPing() {
        if (ws.value && connected.value) {
            ws.value.send(JSON.stringify({
                type: 'ping'
            }));
        }
    }

    // Helper functions
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
        
        // Don't show typing indicator for current user
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

    // Clear all data
    function clearChat() {
        disconnectFromRoom();
        messages.value = [];
        error.value = null;
        onlineUsers.value = [];
        typingUsers.value = [];
    }

    // Handle new message notification
    async function handleNewMessageNotification(message) {
        try {
            const authStore = useAuthStore();
            const userData = authStore.getUserData();
            
            // Don't show notification for own messages
            if (userData && message.sender.id === userData.id) {
                console.log('[ChatStore] Skipping notification for own message');
                return;
            }
            
            console.log('[ChatStore] Checking notification conditions...');
            console.log('[ChatStore] Page visibility - hidden:', document.hidden, 'focused:', document.hasFocus());
            
            // Use notification manager instead of composable to avoid Vue context issues
            const notificationManager = (await import('../utils/notificationManager')).default;
            
            console.log('[ChatStore] Notification settings:');
            console.log('  - Supported:', notificationManager.isSupported);
            console.log('  - Enabled:', notificationManager.isEnabled);
            console.log('  - Permission:', notificationManager.permission);
            console.log('  - Should show:', notificationManager.shouldShowNotification());
            
            // Show notification if enabled and supported
            if (notificationManager.isSupported && notificationManager.isEnabled) {
                console.log('[ChatStore] Attempting to show notification for message:', message);
                
                const notification = notificationManager.showMessageNotification(message, currentRoomName.value);
                
                // Handle notification click to focus the tab
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

    // Handle successful background sync
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
        currentRoomId,
        currentRoomName,
        onlineUsers,
        typingUsers,
        connectToRoom,
        disconnectFromRoom,
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
