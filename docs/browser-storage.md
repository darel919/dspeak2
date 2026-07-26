# Browser storage ownership

dSpeak keeps startup-sized device preferences in localStorage, authentication
redirect state in sessionStorage, structured room and chat data in IndexedDB,
and versioned application assets and navigation responses in Cache Storage.
Session secrets, signaling data, raw diagnostics, and media are never written
to Web Storage.

Participant volume preferences retain the 200 most recent users and 400 most
recent tracks. Per-room soundboard preferences retain the 100 most recent
rooms. Each write emits a `dspeak:browser-storage-metrics` window event with
the storage key, entry count, and UTF-8 byte size. The metric never includes
stored identifiers or values.

Pending read receipts are stored in the `pendingReads` store of `dspeak-chat`.
The schema upgrade is automatic. The first authenticated chat use imports the
legacy user-scoped localStorage array, commits the merged IDs to IndexedDB, and
removes the old key.
