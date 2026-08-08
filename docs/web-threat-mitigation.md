# Web threat mitigation

## Request forgery

Authenticated session cookies are host-only, HTTP-only, secure in production,
and use `SameSite=Strict`. State-changing API requests must also satisfy all of
the following:

- the request is same-origin according to Fetch Metadata or has the exact
  configured application origin
- the `X-dSpeak-CSRF-Token` header matches the HMAC token bound to the current
  session
- the endpoint's authentication, authorization, input, and rate limits pass

The browser fetch boundary learns the current token from authenticated response
headers and adds it to same-origin mutations. The service worker refreshes the
token before replaying queued messages. Supabase Auth owns OAuth state, callback,
and session refresh handling.
CSP reports carry no authenticated mutation and are exempt from the token.

Never mutate state from `GET`, `HEAD`, or `OPTIONS` routes. New browser request
implementations must use the centralized fetch boundary rather than creating a
second transport.

## Server-side requests

User-controlled Web Push endpoints pass through the outbound request policy at
registration and again immediately before delivery. HTTPS credentials,
nonstandard ports, prohibited hostnames, and destinations without public DNS
addresses are rejected. Delivery uses a custom HTTPS agent that resolves and
checks the address when opening the connection, which prevents a previously
approved hostname from rebinding to private infrastructure.

`DSPEAK_PUSH_ALLOWED_HOSTS` accepts a comma-separated hostname allowlist.
Subdomains of an allowed hostname are accepted. Leave it empty only when all
public Web Push providers must be supported and network egress controls are
enforced outside the application.

The production container drops Linux capabilities, prohibits privilege
escalation, uses a read-only root filesystem, and grants only a bounded,
non-executable temporary filesystem. The deployment firewall must deny access
from the application container to loopback services, link-local networks, cloud
metadata addresses, container control sockets, private control planes, and
databases and internal control planes.

Docker Compose cannot express hostname-based outbound firewall rules. Apply
egress policy in the host firewall, container platform, or an allowlisting HTTPS
proxy. Required destinations are:

- the configured Supabase origin
- the configured R2 endpoint
- the configured media-control and standalone provider origins
  enabled
- approved Web Push provider origins
- DNS resolvers and certificate infrastructure required by the deployment

## Script injection

Vue text bindings are the rendering boundary for user-authored content. The
application source is tested to reject `v-html`, direct HTML DOM sinks,
string-to-code execution, `document.write`, and `javascript:` URLs. Production
CSP combines per-response nonces, `strict-dynamic`, disabled script attributes,
Subresource Integrity, and Trusted Types restricted to Vue.

Do not introduce HTML-string formatters. Rich message formatting must use a
tokenized representation rendered through Vue components. Any future exception
requires a dedicated sanitizer, a narrowly scoped Trusted Types policy, focused
tests, and a CSP review.

## Cross-site information leaks

Private API responses use `Cache-Control: no-store`. Same-site and cross-site
Fetch Metadata requests to API reads are rejected, preventing cross-origin
images, scripts, media, frames, and windows from probing authenticated
resources. COOP, COEP, CORP, frame restrictions, an origin agent cluster, and a
strict referrer policy provide additional browser isolation.

Sensitive existence checks must not reveal private state through distinct
redirects, response bodies, or avoidable timing differences. New private asset
routes must require authorization and return same-origin resource policy and
private no-store caching.

## Production verification

1. Confirm mutations without a token, with a stale token, and from cross-origin
   and same-site origins return `403`.
2. Confirm authenticated browser mutations and service-worker queue replay
   succeed with a fresh token.
3. Attempt push registration with loopback, RFC1918, link-local, metadata, IPv6
   unique-local, and disallowed hostnames.
4. Confirm outbound firewall logs show denied private and control-plane traffic.
5. Confirm CSP contains Trusted Types directives and Chromium reports no policy
   creation or HTML-sink violations.
6. Probe private API and media routes from a foreign origin and confirm they
   return the uniform cross-origin rejection without exposing private content.
