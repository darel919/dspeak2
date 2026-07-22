#!/bin/sh
set -eu

log() {
  printf '%s [coturn] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"
}

log "Container supervisor started"

certificate=/etc/letsencrypt/runtime/fullchain.pem
private_key=/etc/letsencrypt/runtime/privkey.pem

trap 'exit 0' TERM INT

if [ ! -s "$certificate" ] || [ ! -s "$private_key" ]; then
  log "Waiting for the initial TLS certificate for ${DSPEAK_RTC_DOMAIN}"
fi

while [ ! -s "$certificate" ] || [ ! -s "$private_key" ]; do
  sleep 5 &
  wait $! || true
done

log "TLS certificate is ready; starting TURN server"
/usr/bin/turnserver -n "$@" &
turn_pid=$!

terminate() {
  kill -TERM "$turn_pid" 2>/dev/null || true
  wait "$turn_pid" 2>/dev/null || true
  exit 0
}

trap terminate TERM INT

certificate_state="$(cksum "$certificate" "$private_key")"

while kill -0 "$turn_pid" 2>/dev/null; do
  sleep 60 &
  wait $! || true
  next_state="$(cksum "$certificate" "$private_key" 2>/dev/null || true)"
  if [ -n "$next_state" ] && [ "$next_state" != "$certificate_state" ]; then
    log "TLS certificate changed; reloading TURN server"
    kill -USR2 "$turn_pid"
    certificate_state="$next_state"
  fi
done

if wait "$turn_pid"; then
  status=0
else
  status=$?
fi
log "TURN server exited with code ${status}"
exit "$status"
