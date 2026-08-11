# Direct messages

Direct messages are one-to-one conversations between users with an accepted
friendship. The server checks the friendship for every conversation open,
message read, and message send operation.

## Persistence

Migration 0010_nasty_green_goblin.sql adds:

- direct_conversations, with a canonical participant pair and one conversation
  per pair.
- direct_messages, with stable client IDs for retry-safe sends and a nullable
  delivered_at and read_at timestamp for delivery and read receipts.

Deleting an account deletes its direct conversations. Account export includes
the conversations and messages visible to that account.

## HTTP API

- GET /api/direct-messages returns the authenticated user's conversations.
- POST /api/direct-messages with { "friendId": "..." } opens or creates a
  conversation with an accepted friend.
- GET /api/direct-messages/:conversationId returns the latest messages and marks
  messages from the friend as read.
- POST /api/direct-messages/:conversationId with content and clientMessageId
  creates an idempotent message.
- PATCH /api/direct-messages/:conversationId marks the conversation as read.
- PATCH /api/direct-messages/:conversationId with { "action": "delivered",
  "messageIds": ["..."] } records delivery for messages received by the
  authenticated friend.

New messages are published on the existing user-scoped notify:<userId>
realtime topic as direct_message events. The recipient also receives a
persisted direct_message notification and a notification_created event. The
browser subscribes through the same shared realtime channel used by
notifications, and notification-center entries link back to the conversation.
