# Privacy Policy

**Last updated: August 8, 2026**

## 1. What dSpeak Is

dSpeak is a communication platform for text chat, voice, video, and screen sharing. Each deployment is independently operated. This policy describes how an instance operator collects, uses, and shares personal data.

## 2. Data We Collect

### 2.1 Information You Provide

- **Account profile:** email address, name, username, display name, and avatar supplied through Google OAuth and Supabase Auth.
- **Messages and reactions:** channel messages, edits, replies, reactions, pins, and bookmarks.
- **Uploads:** message attachments, room images, avatars, soundboard audio, and related metadata.
- **Room and social data:** memberships, roles, invites, moderation history, friends, and nicknames.
- **Notification preferences:** in-app and Web Push settings.
- **Media state:** current voice channel, mute/deafen state, published source types, route state, and transient connection diagnostics.

### 2.2 Information Collected Automatically

- **Authentication data:** Supabase access and refresh tokens managed by the Supabase client session.
- **Presence:** online, idle, do-not-disturb, and offline state.
- **Push subscriptions:** browser push endpoint and encryption keys required for delivery.
- **Operational data:** bounded health, error, CSP, upload, and media diagnostics. Operators should not place message content, tokens, ICE credentials, or unnecessary personal identifiers in logs or metrics.
- **Network addresses:** WebRTC peers, TURN, SFU, and media-control providers necessarily process IP addresses while establishing or carrying media.

### 2.3 Browser Storage

| Storage                         | Purpose                                                                     | Duration                                 |
| ------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| Supabase client session storage | OAuth access/refresh session                                                | Until logout, expiry, or browser cleanup |
| `localStorage`                  | Device preferences such as mic/deafen state, volumes, theme, and appearance | Persistent                               |
| IndexedDB                       | Cached rooms, messages, read state, and offline message queue               | Persistent                               |

dSpeak does not use advertising or analytics cookies.

## 3. How We Use Data

We use data to operate chat and rooms, authorize actions, deliver notifications, store protected uploads, coordinate encrypted media connections, prevent abuse, and diagnose failures. We do not sell personal data, use it for advertising, or share it with analytics services.

## 4. Service Providers

Depending on instance configuration, data is processed by:

- **Google and Supabase Auth** for sign-in and session management;
- **Supabase PostgreSQL and Realtime** for durable application records and app events;
- **Cloudflare R2** for uploaded file bytes;
- **Cloudflare Workers and Durable Objects** for persistent media control and signaling;
- **Cloudflare Realtime and TURN** for SFU forwarding or relayed media;
- **a standalone `dspeak-sfu` operator** when the optional self-hosted media provider is selected;
- **Web Push providers** for device notifications; and
- **other users' devices** when direct peer-to-peer media is selected.

Media is encrypted in transit by WebRTC. An SFU or TURN provider forwards encrypted transport packets but necessarily observes connection metadata such as IP addresses and traffic timing. Direct P2P participants can observe peer network addresses unless a relay route is used.

## 5. Data Retention

- Messages, room records, and upload metadata remain until deleted according to application and operator policy.
- R2 objects remain while referenced by authorized metadata; cleanup jobs remove abandoned or unreferenced uploads.
- Supabase sessions remain until logout, revocation, or expiry under the configured Auth policy.
- Push subscriptions remain until unsubscribed, rejected by the provider, or deleted with the account.
- Durable Object media membership and signaling state are transient; operational logs follow the instance operator's retention policy.
- Audit records may remain for the lifetime of a room or as required for security and legal obligations.

## 6. Your Rights

Depending on jurisdiction, users may request access, export, correction, deletion, restriction, or objection. Account settings provide export and deletion features where available; otherwise contact the instance operator.

## 7. Security

The system uses asymmetric JWT verification, PostgreSQL row-level security, server-only service credentials, short-lived signed media tickets, private R2 objects with scoped upload URLs, CSRF and origin controls, and encrypted HTTPS/WebSocket/WebRTC transport. No security measure is perfect; users should review their instance operator's policies.

## 8. Children

dSpeak is not intended for children under 13. Operators should follow any higher minimum age or consent requirement that applies in their jurisdiction.

## 9. Changes

Operators may update this policy as services or legal requirements change. Material changes should be announced through the instance.

## 10. Contact

Contact the instance operator using the details published at `https://dspeak.darelisme.my.id`.
