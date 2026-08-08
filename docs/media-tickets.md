# Media tickets — dspeak (main app, Vercel)

This app **signs** media tickets. It never verifies them, and it never sees
the provider-ticket keypair (that belongs to `dspeak-media-control` and
`dspeak-sfu`).

## The one key you need here

`MEDIA_TICKET_PRIVATE_KEY` — the **private half** of the media-ticket Ed25519
keypair. It must match the public half that `dspeak-media-control` holds as
`MEDIA_TICKET_PUBLIC_KEY`.

- These two env vars are **the same keypair, split across two deployments.**
  Not two keys, not a secret shared as-is — one asymmetric pair, private here,
  public there.
- Generate **once**, on any machine, then put each half where it belongs:

```bash
openssl genpkey -algorithm Ed25519 -out media-ticket-private.pem
openssl pkey -in media-ticket-private.pem -pubout -out media-ticket-public.pem

# dspeak (this repo) → set env:
MEDIA_TICKET_PRIVATE_KEY="$(base64 -i media-ticket-private.pem)"

# dspeak-media-control → set env:
MEDIA_TICKET_PUBLIC_KEY="$(base64 -i media-ticket-public.pem)"
```

> macOS `base64` has no `-w 0`; use `-i`. `base64ToPEM()` in the control
> plane strips whitespace anyway, so either wrapped or unwrapped base64 works.

## Other env used here

| Var                        | Purpose                                       | Default                             |
| -------------------------- | --------------------------------------------- | ----------------------------------- |
| `MEDIA_TICKET_PRIVATE_KEY` | sign media tickets (Ed25519 PKCS8 PEM base64) | — required                          |
| `MEDIA_CONTROL_URL`        | returned to clients as the WebSocket URL      | `https://media-control.example.com` |
| `MEDIA_CONTROL_ISSUER`     | issuer claim stamped into tickets             | `dspeak-media-control`              |

## What the ticket carries

`POST /api/media/bootstrap` (auth required) returns:

```json
{
  "mediaControlUrl": "wss://media-control.example.com/media-control/<channelId>",
  "protocolVersion": 919,
  "ticket": "<EdDSA JWT, 2-minute expiry>",
  "expiresIn": 120
}
```

Ticket claims: `sub` (user id), `channelId`, `roomId`, `connectionMode`,
`routeEpoch: 0`, plus standard `iss` (`MEDIA_CONTROL_ISSUER`),
`aud: "dspeak-media-control"`, `iat`, `exp` (2m).

The client then connects to `mediaControlUrl` and sends the ticket as
`hello919`. `dspeak-media-control` verifies it with
`MEDIA_TICKET_PUBLIC_KEY`.

## Do NOT

- Do not set `MEDIA_TICKET_PRIVATE_KEY` to `PROVIDER_TICKET_PRIVATE_KEY` from
  dspeak-media-control. Different keypair, different audience — signatures
  would fail verification and auth breaks.
- Do not use the old `MEDIA_TICKET_SECRET` symmetric secret (now dead).
- Do not store `MEDIA_TICKET_PUBLIC_KEY` here; this side never verifies.

## Related

- `dspeak-media-control/docs/media-tickets.md` — the verifier side
- `dspeak-sfu/docs/media-tickets.md` — the provider-ticket consumer
