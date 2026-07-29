# Local Broadcast Runtime Decision

## Trigger

Task 3 (browser loopback audio compatibility) determined that a direct
browser-to-VLC HTTP stream is not viable because VLC 3.0.23's `http` access
output module sends `Content-Type: application/octet-stream` and no CORS
headers. Modern browsers rely on Content-Type negotiation for `<audio>` element
decoding and refuse `application/octet-stream` media.

## Compatibility evidence

| Runtime | Direct VLC stream | With Nitro proxy | Notes |
|---------|------------------|-------------------|-------|
| Chromium (Brave) | ❌ No | ✅ Yes | All 5 probe tests pass via proxy |
| Safari | ❌ No | ✅ Yes (deduced) | Same Content-Type dependency |
| Firefox | Not tested | ✅ Yes (deduced) | Not installed on dev machine |

The proxy rewrites `Content-Type: audio/ogg` and adds
`Access-Control-Allow-Origin: *`. Chromium decodes the stream successfully
through this path; Safari and Firefox share the same Content-Type dependency
and are expected to behave identically.

## Decision

**Adopt the Nitro server proxy approach** documented at
`server/routes/api/broadcast/stream.get.js`.

- The dSpeak Nitro server already runs on localhost during development and
  deployment.
- No new dependencies, ports, or runtime boundaries are introduced.
- The proxy is a single 27-line server route.
- No browser extensions, display capture, unsafe flags, or Private Network
  Access negotiation are required.
- The CSP (`media-src: "'self'"`) permits loading from the same origin without
  modification.

## Rejected alternatives

- **Pure browser→VLC direct**: Rejected because VLC cannot be configured to
  send browser-compatible HTTP headers.
- **Isolated Web App / Direct Sockets**: Rejected because Safari must remain
  supported and IWA is Chromium-only.
- **Server-side HTTPS ingest forcing SFU**: Rejected because P2P eligibility
  for broadcast audio is a non-negotiable requirement.
- **Standalone Node.js proxy** (separate process): Rejected because the dSpeak
  Nitro server already fills this role without adding a second moving part.

## Status

Accepted and implemented. Task 4 (capture class and proxy route) and Task 5
(broadcast UI workflow) are complete.
