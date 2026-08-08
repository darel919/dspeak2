import { createHmac } from "node:crypto";

const PUBLIC_STUN_SERVERS = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function port(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535
    ? parsed
    : fallback;
}

export function createTurnCredentials({
  secret,
  ttlSeconds = 900,
  now = Date.now(),
}) {
  if (!secret)
    throw new Error(
      "TURN_SHARED_SECRET is required to create TURN credentials",
    );
  const expiresAt = Math.floor(now / 1000) + positiveInteger(ttlSeconds, 900);
  const username = `${expiresAt}:dspeak`;
  return {
    username,
    credential: createHmac("sha1", secret).update(username).digest("base64"),
    expiresAt,
  };
}

export function createIceServers(
  environment = process.env,
  now = Date.now(),
  options = {},
) {
  const { connectionMode = "auto" } = options;
  const host = environment.DSPEAK_RTC_DOMAIN?.trim();
  const secret = environment.TURN_SHARED_SECRET?.trim();
  const servers = [];

  // STUN servers always included (for ICE connectivity checks)
  servers.push(...PUBLIC_STUN_SERVERS);

  // TURN servers only for non-Direct modes
  if (connectionMode !== "direct") {
    if (host && secret) {
      const credentials = createTurnCredentials({
        secret,
        ttlSeconds: environment.TURN_CREDENTIAL_TTL_SECONDS,
        now,
      });
      servers.push({
        urls: [
          `stun:${host}:${port(environment.TURN_PORT, 3478)}`,
          `turn:${host}:${port(environment.TURN_PORT, 3478)}?transport=udp`,
          `turn:${host}:${port(environment.TURN_PORT, 3478)}?transport=tcp`,
          `turns:${host}:${port(environment.TURN_TLS_PORT, 5349)}?transport=tcp`,
        ],
        username: credentials.username,
        credential: credentials.credential,
      });
    }
  }

  return servers;
}

export async function createCloudflareTurnServers(
  environment = process.env,
  fetchImplementation = fetch,
) {
  const keyId = environment.CLOUDFLARE_TURN_KEY_ID?.trim();
  const apiToken = environment.CLOUDFLARE_TURN_API_TOKEN?.trim();
  if (!keyId || !apiToken) return [];
  const response = await fetchImplementation(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ttl: positiveInteger(
          environment.CLOUDFLARE_TURN_CREDENTIAL_TTL_SECONDS,
          86400,
        ),
      }),
    },
  );
  if (!response.ok)
    throw new Error(`Cloudflare TURN credentials failed (${response.status})`);
  const body = await response.json();
  const iceServers = Array.isArray(body.iceServers)
    ? body.iceServers
    : body.iceServers
      ? [body.iceServers]
      : [];
  return iceServers.filter(
    (server) =>
      server &&
      server.urls &&
      typeof server.username === "string" &&
      typeof server.credential === "string",
  );
}

export { PUBLIC_STUN_SERVERS };
