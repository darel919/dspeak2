#!/bin/bash
set -euo pipefail

# Configuration
PORT="${BROADCAST_PORT:-19350}"
VLC="${VLC_BIN:-/Applications/VLC.app/Contents/MacOS/VLC}"
FIXTURE="${BROADCAST_FIXTURE:-tests/fixtures/broadcast-tone.wav}"

# Ensure fixture exists
if [ ! -f "$FIXTURE" ]; then
  echo "Generating broadcast tone fixture..."
  mkdir -p "$(dirname "$FIXTURE")"
  bun scripts/generate-broadcast-tone.mjs "$FIXTURE"
fi

echo "Starting VLC loopback broadcast on 127.0.0.1:${PORT}"
echo "Fixture: $FIXTURE"
echo "Process ID: $$"

# Start VLC as HTTP streamer on loopback only
# VLC serves the tone as Ogg Vorbis over HTTP
exec "$VLC" \
  --intf dummy \
  --no-audio \
  --repeat \
  --no-video \
  --sout "#transcode{acodec=vorbis,ab=128,channels=2,samplerate=48000}:http{mux=ogg,dst=127.0.0.1:${PORT}/}" \
  --sout-keep \
  "$FIXTURE"
