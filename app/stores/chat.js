import { defineStore } from "pinia";
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
                throw new Error(`Failed to send message: ${response.status}`);
            }

            const message = await response.json();
            return message;
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
        clearChat
    };
});
