import { createHmac } from "node:crypto";

const PUBLIC_STUN_SERVERS = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

type Environment = Record<string, string | undefined>;

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function port(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535
    ? parsed
    : fallback;
}

export function createTurnCredentials({
  secret,
  ttlSeconds = 900,
  now = Date.now(),
}: {
  secret: string;
  ttlSeconds?: number;
  now?: number;
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
  environment: Environment = process.env,
  now = Date.now(),
  options: { connectionMode?: string } = {},
) {
  const { connectionMode = "auto" } = options;
  const host = environment.DSPEAK_RTC_DOMAIN?.trim();
  const secret = environment.TURN_SHARED_SECRET?.trim();
  const servers: IceServer[] = [];

  servers.push(...PUBLIC_STUN_SERVERS);

  if (connectionMode !== "direct") {
    if (host && secret) {
      const credentials = createTurnCredentials({
        secret,
        ttlSeconds: Number(environment.TURN_CREDENTIAL_TTL_SECONDS),
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
  environment: Environment = process.env,
  fetchImplementation: typeof fetch = fetch,
) {
  const appId = environment.CF_TURN_APP_ID?.trim();
  const apiKey = environment.CF_TURN_API_KEY?.trim();
  if (!appId || !apiKey) return [];
  const response = await fetchImplementation(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(appId)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ttl: positiveInteger(environment.CF_TURN_CREDENTIAL_TTL_SECONDS, 86400),
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
  return iceServers.filter((server: unknown): server is IceServer =>
    Boolean(
      server &&
      typeof server === "object" &&
      "urls" in server &&
      (typeof server.urls === "string" || Array.isArray(server.urls)) &&
      "username" in server &&
      typeof server.username === "string" &&
      "credential" in server &&
      typeof server.credential === "string",
    ),
  );
}

export { PUBLIC_STUN_SERVERS };
