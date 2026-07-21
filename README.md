# Nuxt Minimal Starter

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

## Setup

Make sure to install dependencies:

```bash
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install

# bun
bun install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev

# pnpm
pnpm dev

# yarn
yarn dev

# bun
bun run dev
```

## Production

Build the application for production:

```bash
# npm
npm run build

# pnpm
pnpm build

# yarn
yarn build

# bun
bun run build
```

Locally preview production build:

```bash
# npm
npm run preview

# pnpm
pnpm preview

# yarn
yarn preview

# bun
bun run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.

## Mediasoup SFU

The Nitro server now owns the complete DSpeak backend surface:

- `/dspeak/room/*`, `/dspeak/channel/*`, and `/dspeak/chat/*` HTTP APIs
- `/dspeak/chat/socket` for chat events
- `/dspeak/presence` for online state
- `/socket` for mediasoup signaling
- `/health` and `/metrics` for operations

These endpoints use the current origin by default, so local development needs
no API or WebSocket host overrides. Set the PocketBase credentials from
`.env.example` before using rooms, channels, chat, or voice.

Nitro validates required environment variables during startup and terminates
immediately when credentials are missing, URLs are invalid, the media port
range is invalid, or a wildcard media bind has no announced address.

Production must use the Node server preset (not an edge or serverless preset),
run as a long-lived process, and expose both the HTTP/WebSocket port and the
configured WebRTC UDP/TCP port range:

```dotenv
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_ADDRESS=203.0.113.10
MEDIASOUP_RTC_MIN_PORT=40000
MEDIASOUP_RTC_MAX_PORT=49999
```

`MEDIASOUP_ANNOUNCED_ADDRESS` must be the public IP or resolvable address that
browsers can reach. The SFU validates the supplied user against the channel's
room membership and rejects non-media channels. The inherited DSpeak contract
still identifies users through the `Authorization` header or `auth` query
parameter; migrating that contract to signed access tokens is a separate auth
boundary change.

Build and run the complete monolith with:

```bash
docker build -t dspeak .
docker run --env-file .env -p 3000:3000 \
  -p 40000-49999:40000-49999/udp \
  -p 40000-49999:40000-49999/tcp dspeak
```
