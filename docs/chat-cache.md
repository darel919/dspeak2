# Chat cache and room switching

Chat history uses a stale-while-revalidate lifecycle. Each authenticated user's
channel history is held in a channel-scoped memory cache and persisted in the
`dspeak-chat` IndexedDB database. Returning to a channel paints its last known
messages immediately while the HTTP endpoint refreshes them in the background.
The server response remains authoritative.

Every channel connection has a monotonically increasing client generation.
Fetch responses and WebSocket events are accepted only when they belong to the
active generation and channel. Switching rooms aborts the previous request,
detaches the previous socket handlers, and prevents late work from replacing
the newly selected channel.

Route teardown is channel-owned. Nuxt may mount a destination room before it
unmounts the previous room, so an obsolete page may disconnect only the channel
it originally rendered. It cannot cancel or clear a newer room connection.

The separate `chat-bg-worker` IndexedDB database owns offline outgoing messages.
The application and service worker both call the shared `app/utils/idb.js`
boundary. Consumers never open databases or construct transactions. The shared
boundary preserves the installed `dspeak-cache`, `dspeak-chat`, and
`chat-bg-worker` schemas while ensuring every read and write waits for its
native transaction to finish. The service worker flushes the queue after
Background Sync or an explicit online retry.

Logging out removes only the outgoing user's browser data before navigation.
That purge deletes the user's cached rooms, cached channel messages, offline
outgoing messages, and pending read-receipt IDs. It also clears the equivalent
in-memory chat caches so late channel work cannot restore signed-out data.
Device-scoped preferences such as appearance, media settings, volume, and
selected input or output devices remain available. Deployment-scoped PWA asset
and page caches also remain because they contain application resources rather
than authenticated API responses.

The boundary converts Vue reactive room and message state into plain
JSON-compatible snapshots before writing. Browser IndexedDB therefore never
receives reactive proxies that cannot be structured-cloned.

Queued messages never contain an access token. Same-origin session cookies
authenticate delivery, and a stable client message ID makes every retry
idempotent. The queue is also retried when connectivity returns and when a new
service-worker controller activates, so Background Sync support is not required.

The service worker precaches only build-manifest assets. Navigations and API
requests remain network-owned so cached application data cannot replace live
authentication or chat responses. Activation removes obsolete precache
versions and entries before claiming clients.

An updated service worker remains in the waiting state while an older client is
open. The application checks for updates at startup, when a tab becomes visible,
when connectivity returns, and once per hour. A persistent refresh notice lets
the user activate the waiting worker and reload as one controlled operation.
The notice is visible only while an installed worker is actually waiting.
Activation clears it, and the page reloads only after the browser confirms that
the selected worker controls the page. A controller change without a waiting
worker clears stale notice state instead of reporting another update.
Registration keeps the stable `/sw.js` URL required by the service-worker
update algorithm. The browser compares that script byte for byte with the
installed worker, bypasses its HTTP cache during update checks, and the worker
response requires revalidation while disabling shared-CDN storage.
The application registration module is the only service-worker registrar. The
PWA module registrar stays disabled so an unversioned registration cannot race
the application registration. Startup also removes legacy dSpeak registrations
found under an obsolete scope. When another tab activates an accepted update,
remaining tabs show a reload notice without attempting to activate the same
worker again.

Interrupted and invalid transactions receive one clean reopen-and-retry before
the failure reaches a consumer. IndexedDB errors are normalized and sent to the
main application from either the page or service worker. Recoverable failures
clear silently after retry. Capacity and unavailable-storage failures show a
non-blocking warning while online behavior continues. Schema, version, and
unknown database failures show a persistent repair prompt.

The repair prompt first offers a refresh. A destructive reset requires an
explicit second confirmation and removes only dSpeak's three browser databases.
It explains that cached rooms, cached messages, and messages waiting to send
will be removed. Browser quota and persistence estimates come from the Storage
Manager API when available.

Queueing an offline message also asks the Storage Manager API for persistent
origin storage. Browsers may grant or deny persistence according to their own
engagement and storage policies. Denial does not block messaging, but a grant
reduces the chance that the browser evicts unsent messages under storage
pressure.

When the browser is offline, chat enters one explicit offline state instead of
surfacing HTTP and WebSocket failures independently. Saved channel history
remains visible, presence is marked unavailable, and outgoing messages are
stored in the offline queue. Network errors and manual retry controls remain
hidden until connectivity returns. Reconnection refreshes the active channel
and flushes queued messages automatically.

Successful document navigations are stored in a deployment-scoped page cache.
An offline reload can therefore reopen a previously loaded route with assets
from the same application build. API responses remain network-only. Routes
which have never been loaded return a small intentional offline document rather
than the browser's generic network failure page.

Desktop room selection resolves the destination channel before changing the
route. After startup, room channels and text history are warmed silently with
bounded concurrency. Pointer focus or hover prioritizes that room. Navigation
commits only after the destination snapshot is ready, so the current chat
remains intact rather than exposing an intermediate loading frame. A recently
prepared snapshot suppresses the duplicate foreground refresh when the channel
connects. Channel and preparation requests are deduplicated, and the current
channel collection is not cleared while another room loads. Opening a room also
warms its remaining text channels in the background so later channel changes
can paint from memory immediately.

The channel route renders one responsive chat tree. Desktop and mobile controls
use CSS breakpoints around the same `ChatWindow` instance; they are not parallel
`v-show` trees with duplicate lifecycle hooks. Channel-list components emit one
selection event and the route page is the sole navigation owner, preventing
back-to-back navigations and connection initialization. The dynamic channel
page has one stable Nuxt page key, so changing room or channel parameters
updates the existing page instance instead of remounting its entire chat tree.
Selected-channel lookup reads the destination room's cached collection rather
than the mutable globally active collection. Preparing another room therefore
cannot temporarily make the currently rendered channel disappear.
