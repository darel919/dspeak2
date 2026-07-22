#!/bin/sh
set -eu

certificate="/etc/letsencrypt/live/${DSPEAK_RTC_DOMAIN}/fullchain.pem"
private_key="/etc/letsencrypt/live/${DSPEAK_RTC_DOMAIN}/privkey.pem"

trap 'exit 0' TERM INT

while [ ! -s "$certificate" ] || [ ! -s "$private_key" ]; do
  sleep 5 &
  wait $! || true
done

/usr/bin/turnserver "$@" &
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
    kill -USR2 "$turn_pid"
    certificate_state="$next_state"
  fi
done

wait "$turn_pid"
