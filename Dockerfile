FROM oven/bun:1-debian AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app
COPY --from=build /app/.output ./.output

EXPOSE 3000/tcp
EXPOSE 40000-49999/udp
EXPOSE 40000-49999/tcp

CMD ["node", ".output/server/index.mjs"]
