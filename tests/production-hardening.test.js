import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  authentication,
  metrics,
  sfu,
  signalingPolicy,
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
    "../server/utils/authentication.js",
    "../server/routes/metrics.js",
    "../server/utils/mediasoup-sfu.js",
    "../server/utils/media-signaling-policy.js",
    "../server/utils/rate-limit.js",
    "../server/middleware/security.js",
    "../nuxt.config.ts",
    "../server/routes/health.js",
    "../server/utils/push-delivery.js",
    "../server/utils/dspeak-api.js",
    "../server/utils/dspeak-rooms-api.js",
    "../server/utils/dspeak-chat-api.js",
    "../server/routes/api/security/csp-report.post.js",
    "../app/plugins/security-fetch.client.js",
    "../server/infrastructure/network/outbound-request.js",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);

test("browser WebSockets enforce an explicit origin policy", () => {
  assert.match(authentication, /isAllowedWebSocketOrigin/);
  assert.match(authentication, /DSPEAK_PUBLIC_ORIGIN/);
  assert.match(authentication, /if \(!origin\) return false/);
  assert.doesNotMatch(authentication, /DSPEAK_ALLOW_ORIGINLESS_WEBSOCKETS/);
});

test("metrics require a bearer token and use a non-initializing SFU snapshot", () => {
  assert.match(metrics, /DSPEAK_METRICS_TOKEN/);
  assert.match(metrics, /getSfuMetricsSnapshot/);
  assert.match(sfu, /const statePromise = globalThis\[stateKey\]/);
});

test("signaling has byte, depth, burst, and queue limits", () => {
  assert.match(signalingPolicy, /maximumSignalBytes = 96_000/);
  assert.match(signalingPolicy, /signalingDepth\(message\) > 12/);
  assert.match(signalingPolicy, /signalBurstCapacity/);
  assert.match(signalingPolicy, /maximumQueuedSignals/);
  assert.match(sfu, /parseSignalingMessage/);
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
  assert.match(nuxtConfig, /"report-to": \["csp-endpoint"\]/);
  assert.match(nuxtConfig, /Reporting-Endpoints/);
  assert.match(cspReports, /enforceRateLimit/);
  assert.match(cspReports, /sanitizeReport/);
  assert.doesNotMatch(security, /Content-Security-Policy/);
  assert.match(health, /readTurnHealth/);
  assert.doesNotMatch(health, /probeSelfHostedTurn/);
  assert.match(health, /getPushMetrics/);
  assert.doesNotMatch(health, /usePocketBaseAdmin/);
  const cachedMetricsReader = pushDelivery.slice(
    pushDelivery.indexOf("export function getPushMetrics"),
  );
  assert.doesNotMatch(cachedMetricsReader, /usePocketBaseAdmin/);
});

test("API security boundaries protect credentials, assets, and errors", () => {
  const configRoute = dspeakApi.slice(
    dspeakApi.indexOf('domain === "config"'),
    dspeakApi.indexOf('domain === "room"'),
  );
  assert.match(configRoute, /requireAuthenticatedUser/);
  assert.match(configRoute, /turn-credentials/);
  assert.match(dspeakApi, /code: "INTERNAL_ERROR"/);
  assert.doesNotMatch(dspeakApi, /pocketBaseError/);
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
  assert.match(authentication, /csrfTokenForSession/);
  assert.match(authentication, /timingSafeEqual/);
  assert.match(security, /validateCsrfRequest/);
  assert.match(security, /same-site/);
  assert.match(security, /cross-site/);
  assert.match(browserSecurityFetch, /X-dSpeak-CSRF-Token/);
  assert.match(browserSecurityFetch, /mutatingMethods/);
  assert.match(outboundRequest, /resolvePublicOutboundAddresses/);
  assert.match(outboundRequest, /createPublicHttpsAgent/);
  assert.match(pushDelivery, /assertSafeOutboundUrl/);
  assert.match(pushDelivery, /agent: pushAgent/);
  assert.match(nuxtConfig, /"require-trusted-types-for": \["'script'"\]/);
  assert.match(
    nuxtConfig,
    /"trusted-types": \["vue", "dspeak-service-worker"\]/,
  );
});

test("obsolete compatibility security paths are absent", () => {
  assert.doesNotMatch(chatApi, /suffix === "subscribe"/);
  assert.doesNotMatch(authentication, /DSPEAK_ALLOW_ORIGINLESS/);
  assert.match(authentication, /__Host-dspeak_session/);
  assert.match(authentication, /__Host-dspeak_auth_handoff/);
});

test("core orchestration is split into bounded ownership modules", async () => {
  const owners = await Promise.all(
    [
      "../app/composables/useHybridMediaSession.js",
      "../app/stores/voice.js",
      "../server/utils/mediasoup-sfu.js",
      "../server/utils/dspeak-api.js",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  const limits = [1100, 850, 1000, 850];
  owners.forEach((source, index) => {
    assert.ok(source.split("\n").length <= limits[index]);
  });
  for (const path of [
    "../app/shared/hybrid-media-diagnostics.js",
    "../app/shared/local-audio-engine.js",
    "../app/shared/media-message-handlers.js",
    "../app/shared/media-source-controller.js",
    "../app/shared/media-topology-view.js",
    "../app/shared/voice-participant-state.js",
    "../server/utils/dspeak-chat-api.js",
    "../server/utils/dspeak-rooms-api.js",
    "../server/utils/media-signaling-policy.js",
    "../server/utils/media-user-state.js",
  ])
    assert.ok((await readFile(new URL(path, import.meta.url), "utf8")).length);
});

test("state-changing audio operations publish or return failures", async () => {
  const [voice, soundboard, systemSounds, videoFeed, nativeP2p] =
    await Promise.all(
      [
        "../app/stores/voice.js",
        "../app/stores/soundboard.js",
        "../app/shared/system-sounds.js",
        "../app/components/VideoFeed.vue",
        "../app/shared/native-p2p.js",
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

test("remote screen acceptance attaches the existing stream to its new video element", async () => {
  const videoFeed = await readFile(
    new URL("../app/components/VideoFeed.vue", import.meta.url),
    "utf8",
  );

  assert.match(
    videoFeed,
    /watch\(\s*\(\) => props\.receiving,\s*\(receiving\) => \{\s*if \(receiving\) nextTick\(attachStream\);/,
  );
});
