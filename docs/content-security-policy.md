# Content Security Policy

dSpeak enforces its Content Security Policy on production SSR responses. The
policy is owned by the Nuxt Security integration in `nuxt.config.ts`; the Nitro
request middleware must not add a second CSP header.

## Script trust

The server generates a cryptographically random nonce for every HTML response.
Nuxt adds that nonce to every rendered script and places the same value in
`script-src`. `strict-dynamic` extends trust from those bootstrap scripts to the
chunks they load. Script attributes such as `onclick` remain prohibited by
`script-src-attr 'none'`.

`'unsafe-inline'` is retained in `script-src` only as the CSP Level 1 fallback
recommended for a nonce-based strict policy. Browsers that support nonces ignore
that fallback when a nonce source is present. It must not be removed without
reviewing the supported-browser policy, and it must never be used without the
nonce and `strict-dynamic`.

Subresource Integrity is enabled for generated assets. New third-party scripts
must be loaded through Nuxt's script integration so they inherit the active
nonce. Do not paste external `<script>` tags or inline event handlers into
templates.

## Styles and application resources

Vue uses runtime style attributes for positions, levels, colors, and other
reactive presentation. CSP nonces apply to `<style>` elements, not changing
`style` attributes, so `style-src` and `style-src-attr` deliberately allow
inline styles. This does not weaken the script execution policy.

The remaining directives allow only the resource classes dSpeak uses:

- same-origin application, manifest, font, and form resources
- HTTPS images and connections
- secure WebSockets
- blob URLs for workers and browser media
- no frames, embedded objects, framing ancestors, or script attributes

The Permissions Policy restricts camera, microphone, display capture,
fullscreen, autoplay, and screen wake lock to dSpeak's own origin and disables
geolocation.

## Deployment verification

After each production build:

1. Start `.output/server/index.mjs` with the production environment.
2. Fetch an SSR page and confirm it has `Content-Security-Policy`, not
   `Content-Security-Policy-Report-Only`.
3. Confirm the nonce in `script-src` matches every rendered `<script nonce>`.
4. Load the page in a fresh Chromium, Firefox, and Safari session and confirm
   there are no CSP violations.
5. Exercise authentication, PWA update, image upload/display, chat WebSockets,
   presence WebSockets, voice, camera, screen share, soundboards, and push
   subscription.

The local build and Chromium smoke test validate header generation and initial
hydration. They do not prove every authenticated or device-specific flow, so the
deployed browser matrix remains a release gate.
