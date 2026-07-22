FROM mwader/static-ffmpeg:8.1.1 AS ffmpeg

FROM oven/bun:1-debian AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN for attempt in 1 2 3; do \
      bun install --frozen-lockfile --network-concurrency 8 --no-progress && break; \
      if [ "$attempt" = 3 ]; then exit 1; fi; \
      rm -rf node_modules /root/.bun/install/cache; \
    done

COPY . .
RUN bun run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV MEDIASOUP_LISTEN_IP=0.0.0.0
ENV MEDIASOUP_ANNOUNCED_ADDRESS=auto

WORKDIR /app
COPY --from=ffmpeg --chmod=0555 /ffmpeg /ffprobe /usr/local/bin/
RUN ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libopus \
  && ffmpeg -hide_banner -muxers 2>/dev/null | grep -q ico \
  && ffprobe -version >/dev/null
COPY --from=build /app/.output ./.output

EXPOSE 3000/tcp
EXPOSE 40000/udp
EXPOSE 40000/tcp

CMD ["node", ".output/server/index.mjs"]
