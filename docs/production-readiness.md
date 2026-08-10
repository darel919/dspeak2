# Production readiness

This document is the release gate for dSpeak. A successful build does not prove authentication, database policies, object storage, push delivery, media control, TURN, or real-browser media paths.

## Authentication

dSpeak uses Supabase Auth with Google OAuth. Supabase owns the OAuth redirect, session persistence, and token refresh lifecycle. The browser sends the Supabase access token as a bearer token to protected Nitro APIs and media bootstrap. Nitro validates the asymmetric JWT locally through the Supabase JWKS and derives identity only from verified claims.

Never put access or refresh tokens in URLs, logs, analytics events, or offline message payloads.

Production Supabase configuration must:

- enable Google OAuth and disable unused sign-in methods;
- allow only the intended `https://app.example.com/auth` redirect;
- use asymmetric JWT signing supported by the local verifier;
- enforce RLS on client-observable tables and private Realtime topics; and
- keep the service-role key out of the browser.

## Data and storage

Apply checked-in Drizzle migrations to Supabase PostgreSQL before routing traffic to a release that requires them. Back up the database before production schema changes and verify foreign keys, unique indexes, RLS policies, and Realtime authorization afterward.

Cloudflare R2 stores upload bytes. PostgreSQL stores object keys, ownership, and authorization metadata. Exercise prepare, upload, commit, protected read, abandoned-upload cleanup, and unreferenced-object reconciliation. Permanent R2 credentials must never reach a client.

## Background notifications

dSpeak uses standards-based Web Push. The server persists device subscriptions and retryable delivery jobs in PostgreSQL. Provider failures, retry age, expired endpoints, and queue growth must be visible through authenticated metrics.

Keep VAPID keys stable across releases. Rotating them invalidates existing subscriptions. On iPhone and iPad, test from an installed Home Screen application with notification permission granted.

## Media control and providers

The main app does not run mediasoup or own a persistent media WebSocket. `dspeak-media-control` Durable Objects own channel membership, route epochs, P2P signaling, provider health, and route commits. Cloudflare Realtime/TURN provide managed SFU and relay paths; standalone `dspeak-sfu` is an optional independent provider.

Before release, verify:

- media bootstrap accepts a valid Supabase bearer token and rejects expired tokens, non-members, and mismatched rooms or channels;
- app-to-control-plane media tickets expire after two minutes and use the correct Ed25519 keypair;
- provider tickets use the separate control-plane keypair;
- direct P2P, Cloudflare TURN, Cloudflare Realtime SFU, and configured `dspeak-sfu` routes work from external networks;
- control-plane state survives a standalone provider failure and selects another eligible route; and
- stale epochs, duplicate participants, and incompatible protocol revisions fail closed.

## Required configuration

Production requires the Supabase, database, R2, media-control, media-ticket, Cloudflare TURN, VAPID, metrics, CSRF, and cron variables listed in `.env.example`. If the optional standalone provider is enabled, configure its URL and metrics token in the app and follow the provider's own deployment runbook.

Secrets must be independently generated and scoped. In particular, do not reuse `CF_MEDIA_TICKET_PRIVATE_KEY` as the control plane's provider-ticket private key.

## Operational checks

`/health` must report application readiness without attempting to initialize an embedded media worker. `/metrics` requires `Authorization: Bearer <DSPEAK_METRICS_TOKEN>` and must not expose user IDs, room IDs, tokens, ICE credentials, or object-store secrets.

Before release:

1. Run `bun install --frozen-lockfile`.
2. Run `bun audit`, `bun run format:check`, `bun run test`, and `bun run build`.
3. Back up Supabase PostgreSQL, apply Drizzle migrations, and verify RLS and Realtime policies.
4. Validate the browser flows in [Content Security Policy](content-security-policy.md) and [Web threat mitigation](web-threat-mitigation.md).
5. Confirm `/health` and authenticated `/metrics` on `https://app.example.com`.
6. Exercise R2 upload commit, download authorization, cleanup, and reconciliation.
7. Run the external-network media matrix in [Hybrid media topology](hybrid-media-topology.md).
8. Restart or redeploy each independent service and confirm recovery without cross-service state corruption.

## Deployed device matrix

The release is not production-ready until sign-in, token refresh, chat Realtime, uploads, notifications, and media pass on supported desktop and mobile browsers and the Tauri client. For every platform, include logout, expired-token behavior, offline send/reconnect, push unsubscribe, relay-only media, provider failure, and stale subscription cleanup.

Local unit tests cannot prove OAuth redirect configuration, RLS behavior in the hosted project, push-provider delivery, operating-system presentation, hardware capture, public firewalls, TURN allocation, or real SFU reachability.
