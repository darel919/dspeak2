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
This prevents an old application bundle from continuing behind a newly
activated service worker. Other open tabs detect the controller change and show
the same refresh notice.

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
route. The existing room remains rendered while that request is pending, then
the router performs one navigation directly to the destination channel. Channel
requests are deduplicated per room and the current channel collection is not
cleared while another room loads, preventing an intermediate blank room route
or empty channel frame.
