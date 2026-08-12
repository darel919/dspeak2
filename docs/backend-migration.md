# Backend migration

dSpeak uses independently scalable managed and edge services. This document records the current production boundaries.

## Current ownership

| Responsibility                                      | Current owner                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| Browser application and HTTP APIs                   | Nuxt 4 + Nitro on Vercel                                            |
| Authentication                                      | Supabase Auth with Google OAuth                                     |
| Durable application data                            | Supabase PostgreSQL through Drizzle ORM                             |
| Chat, typing, presence, and notification events     | Supabase Realtime                                                   |
| Uploaded file bytes                                 | Cloudflare R2                                                       |
| File metadata and authorization                     | PostgreSQL and Nitro APIs                                           |
| Media membership, signaling, topology, and failover | External `dspeak-media-control` Cloudflare Worker + Durable Objects |
| Managed SFU and relay                               | Cloudflare Realtime and Cloudflare TURN                             |
| Optional self-hosted SFU                            | Standalone `dspeak-sfu` service                                     |

The PostgreSQL schema lives in `server/db/schema/index.ts`, with checked-in Drizzle migrations under `drizzle/`.

## Authentication migration

The browser signs in directly with Supabase Auth's Google provider. Supabase owns the OAuth callback and session refresh lifecycle. The browser presents the Supabase access token to protected Nitro APIs; Nitro validates the asymmetric JWT locally through the project's JWKS and derives the user identity from the verified token.

Media bootstrap uses the Supabase access token rather than a custom application session.

## Media migration

The main Nuxt/Nitro application does not own mediasoup workers, routers, transports, producers, consumers, or a persistent media WebSocket. `POST /api/media/bootstrap` authorizes room access and signs a short-lived media ticket. The client then connects to the URL returned by that endpoint.

A per-channel Durable Object in `dspeak-media-control` owns participant membership, route epochs, P2P signaling relay, provider health, and route commit state. It can select direct P2P, P2P through Cloudflare TURN, Cloudflare Realtime SFU, or the optional standalone `dspeak-sfu` provider. Provider tickets are separate from the app-to-control-plane ticket; see [Media tickets](media-tickets.md).

The standalone `dspeak-sfu` deployment is an independent failure domain. It has no shared process or database with the main app and communicates with the control plane through short-lived signed provider tickets.

## Production runtime

The web/API deployment is serverless-compatible and may scale independently on Vercel. Persistent WebSockets and media topology state remain in Cloudflare Durable Objects. Supabase, R2, `dspeak-media-control`, Cloudflare Realtime/TURN, and any `dspeak-sfu` deployment are configured and monitored as separate services.
