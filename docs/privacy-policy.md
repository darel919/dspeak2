# Privacy Policy

**Last updated: July 28, 2026**

## 1. What dSpeak Is

dSpeak is a self-hosted communication platform for text chat, voice, video, and
screen sharing. This privacy policy describes how the operator of a dSpeak
instance ("we", "us", or "our") collects, uses, and shares personal data when
you use that instance.

Each dSpeak instance is independently operated. This policy applies to the
instance hosted at the domain you are currently using.

## 2. Data We Collect

### 2.1 Information You Provide

- **Account profile**: display name, username, handle, avatar, and **email
  address**. These are obtained from the external identity provider (DWS Account)
  when you sign in.
- **Messages and reactions**: text messages you send in channels, including
  edits and reactions.
- **Media uploads**: files you attach to messages and soundboard audio clips
  you upload.
- **Voice state**: which voice channel you are connected to and your mute or
  deafen status.
- **Friend relationships**: friend requests and your friends list.
- **Notification preferences**: your push notification and in-app notification
  settings.

### 2.2 Information Collected Automatically

- **Session data**: a session token (SHA-256 hashed) linked to your user
  account, device identifier, and last-seen timestamp.
- **Presence status**: whether you are online, idle, do-not-disturb, or
  offline.
- **Push subscription data**: your browser push endpoint, device identifier,
  and user-agent string (for delivering push notifications).
- **CSP violation reports**: if your browser triggers a Content Security Policy
  violation, a sanitized report (without your user identity) may be logged for
  security monitoring.

### 2.3 Cookies and Local Storage

| Storage                             | Purpose                                                             | Duration    |
| ----------------------------------- | ------------------------------------------------------------------- | ----------- |
| `__Host-dspeak_session` cookie      | Session authentication (HttpOnly, Secure, SameSite=Strict)          | 7 days      |
| `__Host-dspeak_auth_handoff` cookie | OAuth handoff state (HttpOnly, Secure, SameSite=Lax)                | 10 minutes  |
| `X-dSpeak-CSRF-Token` header        | CSRF protection (not a cookie)                                      | Per-session |
| localStorage                        | Mic/deafen state, user volumes, theme, soundboard prefs, appearance | Persistent  |
| IndexedDB                           | Cached rooms, messages, read receipts, offline message queue        | Persistent  |

Session cookies are strictly necessary for the application to function. No
tracking, advertising, or analytics cookies are used.

### 2.4 Data from External Services

When you sign in, the external identity provider (DWS Account) shares your
profile metadata (id, name, username, handle, avatar, **email**) with us. We
do not receive or store your password or phone number.

## 3. How We Use Your Data

- To provide and maintain the service (routing messages, managing voice
  connections, delivering notifications).
- To enforce room permissions and moderation actions.
- To diagnose and fix technical issues.
- To generate anonymous, aggregate operational metrics (no user or room
  identifiers in Prometheus metrics).

We do not:

- Sell your personal data to third parties.
- Use your data for advertising or profiling.
- Share your data with analytics services.

## 4. Data Sharing

### 4.1 Other Users

Your profile information, messages, reactions, uploads, presence status, and
voice activity are visible to other users in the rooms and channels you share.

### 4.2 Third-Party Services

- **DWS Account**: receives a one-time handoff code during sign-in to verify
  your identity.
- **Public STUN/TURN servers**: your IP address is visible to these servers
  during WebRTC connection setup (Cloudflare, Google, openrelay.metered.ca).
- **Self-hosted Coturn TURN server**: relays encrypted media when direct
  peer-to-peer connections are not possible.
- **Playit tunnel**: may relay encrypted media traffic over IPv4 as a fallback.
- **ipify.org**: your server's public IPv6 address is queried for
  auto-discovery (no user data).
- **Cloudflare DNS**: used for dynamic DNS updates (server-level, no user
  data).
- **Let's Encrypt**: used for TLS certificate issuance (server-level, no user
  data).

### 4.3 Legal Compliance

We may disclose your data if required by law, valid legal process, or to
protect the rights, property, or safety of our users or the public.

## 5. Data Retention

- **Messages and uploads**: retained until the channel or room is deleted, or
  until you delete your account (messages are anonymized, not hard-deleted, to
  preserve conversation integrity).
- **Session tokens**: retained for 7 days after last activity, or until you
  sign out.
- **Push subscriptions**: retained until you disable notifications or delete
  your account.
- **Audit logs**: retained for the lifetime of the room.

## 6. Your Rights

Depending on your jurisdiction, you may have the right to:

- **Access**: request a copy of your personal data.
- **Export**: download your data in a machine-readable format.
- **Deletion**: request deletion of your account and associated data.
- **Correction**: update your profile information.
- **Object**: object to processing of your data.
- **Withdraw consent**: withdraw consent where processing is based on consent.

To exercise these rights, contact the instance operator or use the account
deletion and data export features available in your account settings.

## 7. Data Security

We implement the following security measures:

- Session tokens are SHA-256 hashed before storage; raw tokens are never
  persisted.
- All API responses use `Cache-Control: no-store`.
- Content Security Policy with nonces and strict-dynamic.
- CSRF protection on all state-changing requests.
- Rate limiting on authentication and API endpoints.
- Outbound HTTP requests are restricted to public addresses.
- Docker containers run read-only with dropped capabilities and
  `no-new-privileges` (when deployed via the provided docker-compose.yml).

No security measure is perfect. You use the service at your own risk.

## 8. Children

dSpeak is not intended for users under the age of 13. We do not knowingly
collect data from children under 13. If you believe a child under 13 has
provided us with personal data, contact the instance operator immediately.

## 9. Changes to This Policy

We may update this privacy policy from time to time. Material changes will be
notified through the application. Continued use after changes take effect
constitutes acceptance of the updated policy.

## 10. Contact

Contact the instance operator for privacy-related inquiries. The operator's
contact information is available on the instance's home page or in the
repository at `https://github.com/darelisme/dspeak`.
