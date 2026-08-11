const requiredVariables = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CF_MEDIA_CONTROL_URL",
  "CF_MEDIA_CONTROL_ADMIN_TOKEN",
  "CF_MEDIA_TICKET_PRIVATE_KEY",
  "CF_R2_ACCOUNT_ID",
  "CF_R2_ACCESS_KEY_ID",
  "CF_R2_SECRET_ACCESS_KEY",
  "CF_R2_BUCKET_NAME",
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

export async function validateRuntimeEnvironment() {
  const environmentRequiredVariables =
    process.env.NODE_ENV === "production"
      ? [
          ...requiredVariables,
          "DSPEAK_PUBLIC_ORIGIN",
          "DSPEAK_METRICS_TOKEN",
          "DSPEAK_CRON_SECRET",
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

  let supabaseUrl;
  let vapidSubject;
  try {
    supabaseUrl = new URL(process.env.SUPABASE_URL);
    vapidSubject = new URL(process.env.VAPID_SUBJECT);
  } catch {
    throw new Error(
      "SUPABASE_URL and VAPID_SUBJECT must be valid absolute URLs",
    );
  }
  if (!["http:", "https:"].includes(supabaseUrl.protocol)) {
    throw new Error("SUPABASE_URL must use http or https");
  }
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
    readPort("TURN_TLS_PORT", 5349);
  }

  const cloudflareTurnAppId = process.env.CF_TURN_APP_ID?.trim();
  const cloudflareTurnApiKey = process.env.CF_TURN_API_KEY?.trim();
  if (Boolean(cloudflareTurnAppId) !== Boolean(cloudflareTurnApiKey)) {
    throw new Error(
      "CF_TURN_APP_ID and CF_TURN_API_KEY must be configured together",
    );
  }
  if (cloudflareTurnAppId) {
    const credentialTtl = Number(
      process.env.CF_TURN_CREDENTIAL_TTL_SECONDS || 86400,
    );
    if (
      !Number.isSafeInteger(credentialTtl) ||
      credentialTtl < 300 ||
      credentialTtl > 86400
    ) {
      throw new Error(
        "CF_TURN_CREDENTIAL_TTL_SECONDS must be an integer between 300 and 86400",
      );
    }
  }

  return {
    supabaseUrl: supabaseUrl.toString(),
  };
}
