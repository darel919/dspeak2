import { isIP } from "node:net";

const requiredVariables = [
  "AUTH_PATH",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DSPEAK_CSRF_SECRET",
  "VAPID_PRIVKEY",
  "VAPID_SUBJECT",
];

function readPort(name, fallback) {
  const raw = process.env[name] || String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return value;
}

function readBitrate(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 30_000) {
    throw new Error(`${name} must be an integer of at least 30000 bps`);
  }
  return value;
}

const defaultAddressDiscoveryUrl = "https://api6.ipify.org";

function isPublicIpv6(value) {
  if (isIP(value) !== 6) return false;

  const normalized = value.toLowerCase();
  const isGlobalUnicast =
    normalized.startsWith("2") || normalized.startsWith("3");
  const isDocumentationRange = normalized.startsWith("2001:db8:");
  return isGlobalUnicast && !isDocumentationRange;
}

async function discoverAnnouncedAddress() {
  const discoveryUrl =
    process.env.MEDIASOUP_ANNOUNCED_ADDRESS_URL?.trim() ||
    defaultAddressDiscoveryUrl;
  let url;
  try {
    url = new URL(discoveryUrl);
  } catch {
    throw new Error(
      "MEDIASOUP_ANNOUNCED_ADDRESS_URL must be a valid absolute URL",
    );
  }
  if (url.protocol !== "https:") {
    throw new Error("MEDIASOUP_ANNOUNCED_ADDRESS_URL must use https");
  }

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (error) {
    throw new Error(
      `Unable to auto-discover the public IPv6 address from ${url.origin}: ${error.message}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Public IPv6 discovery returned HTTP ${response.status} from ${url.origin}`,
    );
  }

  const address = (await response.text()).trim();
  if (!isPublicIpv6(address)) {
    throw new Error(
      `Public IPv6 discovery returned ${JSON.stringify(address)}; expected a globally routable IPv6 address`,
    );
  }
  return address;
}

export async function validateRuntimeEnvironment() {
  const environmentRequiredVariables =
    process.env.NODE_ENV === "production"
      ? [
          ...requiredVariables,
          "DSPEAK_PUBLIC_ORIGIN",
          "DSPEAK_METRICS_TOKEN",
          "DSPEAK_INGEST_AUTH_SECRET",
        ]
      : requiredVariables;
  const missing = environmentRequiredVariables.filter(
    (name) => !process.env[name]?.trim(),
  );
  if (
    !process.env.VAPID_PUBLIC_KEY?.trim() &&
    !process.env.VAPID_PUBKEY?.trim()
  ) {
    missing.push("VAPID_PUBLIC_KEY");
  }
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
  if (process.env.DSPEAK_CSRF_SECRET.trim().length < 32)
    throw new Error("DSPEAK_CSRF_SECRET must contain at least 32 characters");
  if (
    process.env.DSPEAK_INGEST_AUTH_SECRET &&
    process.env.DSPEAK_INGEST_AUTH_SECRET.trim().length < 32
  )
    throw new Error(
      "DSPEAK_INGEST_AUTH_SECRET must contain at least 32 characters",
    );

  let supabaseUrl;
  let authUrl;
  let vapidSubject;
  try {
    supabaseUrl = new URL(process.env.SUPABASE_URL);
    authUrl = new URL(process.env.AUTH_PATH);
    vapidSubject = new URL(process.env.VAPID_SUBJECT);
  } catch {
    throw new Error(
      "SUPABASE_URL, AUTH_PATH, and VAPID_SUBJECT must be valid absolute URLs",
    );
  }
  if (!["http:", "https:"].includes(supabaseUrl.protocol)) {
    throw new Error("SUPABASE_URL must use http or https");
  }
  if (!["http:", "https:"].includes(authUrl.protocol)) {
    throw new Error("AUTH_PATH must use http or https");
  }
  if (process.env.NODE_ENV === "production" && authUrl.protocol !== "https:")
    throw new Error("AUTH_PATH must use https in production");
  if (!["https:", "mailto:"].includes(vapidSubject.protocol)) {
    throw new Error("VAPID_SUBJECT must use https or mailto");
  }
  if (process.env.DSPEAK_PUBLIC_ORIGIN) {
    const publicOrigin = new URL(process.env.DSPEAK_PUBLIC_ORIGIN);
    const developmentLoopback =
      process.env.NODE_ENV !== "production" &&
      publicOrigin.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(publicOrigin.hostname);
    if (
      (publicOrigin.protocol !== "https:" && !developmentLoopback) ||
      publicOrigin.origin !== process.env.DSPEAK_PUBLIC_ORIGIN
    )
      throw new Error(
        "DSPEAK_PUBLIC_ORIGIN must be an HTTPS origin without a path; development may use an HTTP loopback origin",
      );
  }

  const rtcPort = readPort("MEDIASOUP_RTC_PORT", 40000);
  readPort("DSPEAK_INGEST_LISTEN_PORT", 9999);
  readPort("DSPEAK_INGEST_FALLBACK_PORT", 9999);
  const announcedPort = process.env.MEDIASOUP_ANNOUNCED_PORT?.trim()
    ? readPort("MEDIASOUP_ANNOUNCED_PORT", rtcPort)
    : rtcPort;
  const directPort = process.env.MEDIASOUP_DIRECT_PORT?.trim()
    ? readPort("MEDIASOUP_DIRECT_PORT", rtcPort)
    : rtcPort;
  const maxClientOutgoingBitrate = readBitrate(
    "MEDIASOUP_MAX_CLIENT_OUTGOING_BITRATE",
    4_500_000,
  );
  const maxServerOutgoingBitrate = readBitrate(
    "MEDIASOUP_MAX_SERVER_OUTGOING_BITRATE",
    40_000_000,
  );
  if (maxClientOutgoingBitrate > maxServerOutgoingBitrate) {
    throw new Error(
      "MEDIASOUP_MAX_CLIENT_OUTGOING_BITRATE cannot exceed MEDIASOUP_MAX_SERVER_OUTGOING_BITRATE",
    );
  }

  const turnHost = process.env.DSPEAK_RTC_DOMAIN?.trim();
  const turnSecret = process.env.TURN_SHARED_SECRET?.trim();
  if (turnSecret && !turnHost) {
    throw new Error(
      "DSPEAK_RTC_DOMAIN is required when TURN_SHARED_SECRET is configured",
    );
  }
  if (turnSecret) {
    const credentialTtl = Number(
      process.env.TURN_CREDENTIAL_TTL_SECONDS || 900,
    );
    if (
      !Number.isSafeInteger(credentialTtl) ||
      credentialTtl < 300 ||
      credentialTtl > 3600
    ) {
      throw new Error(
        "TURN_CREDENTIAL_TTL_SECONDS must be an integer between 300 and 3600",
      );
    }
    readPort("TURN_PORT", 3478);
  }

  const listenIp = process.env.MEDIASOUP_LISTEN_IP?.trim() || "127.0.0.1";
  let announcedAddress = process.env.MEDIASOUP_ANNOUNCED_ADDRESS?.trim();
  if (announcedAddress?.toLowerCase() === "auto") {
    announcedAddress = await discoverAnnouncedAddress();
  }
  let directAddress = process.env.MEDIASOUP_DIRECT_ADDRESS?.trim();
  if (directAddress?.toLowerCase() === "auto") {
    try {
      directAddress = await discoverAnnouncedAddress();
    } catch (error) {
      directAddress = undefined;
      console.warn(
        `[Server] Direct IPv6 discovery unavailable; continuing with fallback RTC only: ${error.message}`,
      );
    }
  }
  if ((listenIp === "0.0.0.0" || listenIp === "::") && !announcedAddress) {
    throw new Error(
      'MEDIASOUP_ANNOUNCED_ADDRESS must be a public address, DNS-only hostname, or "auto" when MEDIASOUP_LISTEN_IP binds to all interfaces',
    );
  }

  return {
    supabaseUrl: supabaseUrl.toString(),
    authUrl: authUrl.toString(),
    listenIp,
    announcedAddress,
    rtcPort,
    announcedPort,
    directAddress,
    directPort,
    maxClientOutgoingBitrate,
    maxServerOutgoingBitrate,
  };
}
