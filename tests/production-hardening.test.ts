import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  auth,
  metrics,
  mediaControlAdmin,
  rateLimit,
  security,
  nuxtConfig,
  health,
  pushDelivery,
  dspeakApi,
  roomsApi,
  chatApi,
  cspReports,
  browserSecurityFetch,
  outboundRequest,
] = await Promise.all(
  [
    "../server/utils/auth.ts",
    "../server/routes/metrics.ts",
    "../server/utils/media-control-admin.ts",
    "../server/utils/rate-limit.ts",
    "../server/middleware/security.ts",
    "../nuxt.config.ts",
    "../server/routes/health.ts",
    "../server/utils/push-delivery.ts",
    "../server/utils/dspeak-api.ts",
    "../server/utils/dspeak-rooms-api.ts",
    "../server/utils/dspeak-chat-api.ts",
    "../server/routes/api/security/csp-report.post.ts",
    "../app/plugins/security-fetch.client.ts",
    "../server/infrastructure/network/outbound-request.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);
const databaseClient = await readFile(
  new URL("../server/db/client.ts", import.meta.url),
  "utf8",
);

test("browser WebSockets enforce an explicit origin policy", () => {
  assert.match(security, /DSPEAK_PUBLIC_ORIGIN/);
  assert.match(security, /originAllowed/);
  assert.doesNotMatch(security, /DSPEAK_ALLOW_ORIGINLESS_WEBSOCKETS/);
});

test("configured API reads retry once with the active Supabase bearer after cookie auth fails", () => {
  assert.match(browserSecurityFetch, /retryWithSupabaseBearer/);
  assert.match(browserSecurityFetch, /resolveApiRequestTarget/);
  assert.match(browserSecurityFetch, /isConfiguredApiRequest/);
  assert.match(browserSecurityFetch, /response\.status !== 401/);
  assert.match(browserSecurityFetch, /Authorization/);
  assert.match(browserSecurityFetch, /retryableMethods/);
  assert.doesNotMatch(
    browserSecurityFetch,
    /response\.status === 401\)\s*csrfToken = ""/,
  );
});

test("metrics require a bearer token and proxy the standalone SFU snapshot", () => {
  assert.match(metrics, /DSPEAK_METRICS_TOKEN/);
  assert.match(metrics, /DSPEAK_SFU_HTTP_URL/);
  assert.match(metrics, /DSPEAK_SFU_METRICS_TOKEN/);
});

test("media administration is delegated to the authenticated control plane", () => {
  assert.match(mediaControlAdmin, /CF_MEDIA_CONTROL_ADMIN_TOKEN/);
  assert.match(mediaControlAdmin, /"participants"/);
  assert.match(mediaControlAdmin, /"moderate"/);
});

test("forwarded client addresses are trusted only when configured", () => {
  assert.match(rateLimit, /DSPEAK_TRUST_PROXY/);
  assert.match(rateLimit, /xForwardedFor: trustProxy/);
});

test("production CSP enforcement and cached health reads are explicit", () => {
  assert.match(nuxtConfig, /nonce-\{\{nonce\}\}/);
  assert.match(nuxtConfig, /"'strict-dynamic'"/);
  assert.match(nuxtConfig, /contentSecurityPolicyReportOnly: false/);
  assert.doesNotMatch(nuxtConfig, /"script-src"[\s\S]{0,160}"'unsafe-inline'"/);
  assert.doesNotMatch(nuxtConfig, /"connect-src": \["'self'", "https:"/);
  assert.match(nuxtConfig, /"report-to": "csp-endpoint"/);
  assert.match(nuxtConfig, /Reporting-Endpoints/);
  assert.match(cspReports, /enforceRateLimit/);
  assert.match(cspReports, /sanitizeReport/);
  assert.doesNotMatch(security, /Content-Security-Policy/);
  assert.match(health, /readTurnHealth/);
  assert.doesNotMatch(health, /probeSelfHostedTurn/);
  assert.match(health, /getPushMetrics/);

  const cachedMetricsReader = pushDelivery.slice(
    pushDelivery.indexOf("export function getPushMetrics"),
  );
});

test("web icons are bundled locally without a runtime Iconify dependency", () => {
  assert.match(nuxtConfig, /provider: isDesktop \? "server" : "none"/);
  assert.match(nuxtConfig, /fallbackToApi: false/);
  assert.match(
    nuxtConfig,
    /clientBundle: \{[\s\S]*scan: \{[\s\S]*globInclude:/,
  );
  assert.ok(
    nuxtConfig.includes(
      'globInclude: ["**/*.{vue,js,ts,jsx,tsx,md,mdc,mdx,yml,yaml}"],',
    ),
  );
  assert.doesNotMatch(nuxtConfig, /clientBundle: \{\s*collections:/);
});

test("runtime database work has independent capacity from background maintenance", () => {
  assert.match(databaseClient, /DATABASE_POOL_MAX/);
  assert.match(databaseClient, /max: poolSize\("DATABASE_POOL_MAX", 10\)/);
  assert.match(databaseClient, /DIRECT_DATABASE_POOL_MAX/);
});

test("API security boundaries protect credentials, assets, and errors", () => {
  const configRoute = dspeakApi.slice(
    dspeakApi.indexOf('domain === "config"'),
    dspeakApi.indexOf('domain === "room"'),
  );
  assert.match(configRoute, /requireAuthenticatedUser/);
  assert.match(configRoute, /turn-credentials/);
  assert.match(dspeakApi, /code: "INTERNAL_ERROR"/);
  const publicUserPresenter = dspeakApi.slice(
    dspeakApi.indexOf("function presentUser"),
    dspeakApi.indexOf("function presentPublicProfile"),
  );
  assert.doesNotMatch(publicUserPresenter, /\.\.\.user/);
  assert.doesNotMatch(publicUserPresenter, /email/);
  const roomAssets = roomsApi.slice(
    roomsApi.indexOf('suffix === "profile"'),
    roomsApi.indexOf('suffix === "details"'),
  );
  assert.match(roomAssets, /requireAuthenticatedUser/);
  assert.match(roomAssets, /requireRoomMember/);
  assert.match(roomAssets, /private, max-age/);
});

test("CSRF, SSRF, Trusted Types, and cross-site reads are enforced", () => {
  assert.match(auth, /csrfTokenForSession/);
  assert.match(auth, /timingSafeEqual/);
  assert.match(security, /validateCsrfRequest/);
  assert.match(security, /same-site/);
  assert.match(security, /cross-site/);
  assert.match(browserSecurityFetch, /X-dSpeak-CSRF-Token/);
  assert.match(browserSecurityFetch, /mutatingMethods/);
  assert.match(outboundRequest, /resolvePublicOutboundAddresses/);
  assert.match(outboundRequest, /createPublicHttpsAgent/);
  assert.match(pushDelivery, /assertSafeOutboundUrl/);
  assert.match(pushDelivery, /agent: pushAgent/);
  assert.match(nuxtConfig, /"require-trusted-types-for": "'script'"/);
  assert.match(
    nuxtConfig,
    /"trusted-types": \["vue", "dspeak-service-worker"\]/,
  );
});

test("obsolete compatibility security paths are absent", () => {
  assert.doesNotMatch(chatApi, /suffix === "subscribe"/);
  assert.doesNotMatch(auth, /DSPEAK_ALLOW_ORIGINLESS/);
  assert.match(auth, /__Host-dspeak_session/);
});

test("core orchestration is split into bounded ownership modules", async () => {
  const owners = await Promise.all(
    [
      "../app/composables/useHybridMediaSession.ts",
      "../app/stores/voice.ts",
      "../server/utils/media-control-admin.ts",
      "../server/utils/dspeak-api.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  const limits = [1400, 1000, 1200, 1000];
  owners.forEach((source, index) => {
    assert.ok(source.split("\n").length <= limits[index]);
  });
  for (const path of [
    "../app/shared/hybrid-media-diagnostics.ts",
    "../app/shared/local-audio-engine.ts",
    "../app/shared/media-message-handlers.ts",
    "../app/shared/media-provider-recovery.ts",
    "../app/shared/media-source-controller.ts",
    "../app/shared/media-session-cleanup.ts",
    "../app/shared/media-topology-view.ts",
    "../app/shared/voice-participant-state.ts",
    "../server/utils/dspeak-chat-api.ts",
    "../server/utils/dspeak-rooms-api.ts",
    "../server/utils/media-control-admin.ts",
  ])
    assert.ok((await readFile(new URL(path, import.meta.url), "utf8")).length);
});

test("state-changing audio operations publish or return failures", async () => {
  const [voice, soundboard, systemSounds, videoFeed, nativeP2p] =
    await Promise.all(
      [
        "../app/stores/voice.ts",
        "../app/stores/soundboard.ts",
        "../app/shared/system-sounds.ts",
        "../app/components/VideoFeed.vue",
        "../app/shared/native-p2p.ts",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );
  assert.doesNotMatch(
    voice,
    /setSystemAudioBitrate[\s\S]{0,120}\.catch\(\(\) => \{\}\)/,
  );
  assert.doesNotMatch(soundboard, /setSinkId\([^)]*\)\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(
    systemSounds,
    /setSinkId\([^)]*\)\.catch\(\(\) => \{\}\)/,
  );
  assert.doesNotMatch(videoFeed, /\.play\?\.\(\)\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(
    nativeP2p,
    /getSnapshot\(\)[\s\S]{0,120}\.catch\(\(\) => \{\}\)/,
  );
});

test("remote screen acceptance attaches the existing stream without a render tick", async () => {
  const videoFeed = await readFile(
    new URL("../app/components/VideoFeed.vue", import.meta.url),
    "utf8",
  );

  assert.match(
    videoFeed,
    /watch\(\s*\(\) => props\.receiving,\s*\(receiving\) => \{\s*if \(receiving\) attachStream\(\);/,
  );
  assert.doesNotMatch(videoFeed, /nextTick\(attachStream\)/);
});
