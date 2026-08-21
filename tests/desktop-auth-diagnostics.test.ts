import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopAuthError } from "../app/shared/desktop-auth-error.ts";
import {
  mapFailureDiagnostic,
  readDesktopSessionDiagnostic,
} from "../app/shared/desktop-session-diagnostics.ts";

const fingerprint = {
  clientBuildCommit: "client-commit",
  clientProjectRef: "crmucqnebwlssqzthnek",
};

test("transport failure maps to DESKTOP_API_SESSION_TRANSPORT_ERROR", () => {
  const error = createDesktopAuthError(
    "DESKTOP_API_SESSION_BRIDGE_FAILED",
    "Your Google sign-in succeeded, but dSpeak could not create your app session.",
    {
      stage: "session-bridge",
      httpStatus: 0,
      serverDiagnostic: "DESKTOP_API_SESSION_TRANSPORT_ERROR",
      ...fingerprint,
    },
  );

  const diagnostic = mapFailureDiagnostic(error);

  assert.deepEqual(diagnostic, {
    code: "DESKTOP_API_SESSION_TRANSPORT_ERROR",
    stage: "session-bridge",
    httpStatus: null,
    serverBuildCommit: "",
    clientBuildCommit: "client-commit",
    serverProjectRef: "",
    clientProjectRef: "crmucqnebwlssqzthnek",
    requestId: "",
    transport: "webview-fetch",
    requestUrl: "",
    responseUrl: "",
    redirected: false,
    statusText: "",
    retryAfter: "",
    serverHeader: "",
    viaHeader: "",
    vercelRequestId: "",
    cloudflareRay: "",
    contentType: "",
    vercelMitigated: "",
    responseOrigin: "unknown",
    provider: "",
  });
});

test("HTTP token failure keeps server diagnostic and status", () => {
  const error = createDesktopAuthError(
    "DESKTOP_API_SESSION_BRIDGE_FAILED",
    "Your Google sign-in succeeded, but dSpeak could not create your app session.",
    {
      stage: "server-session",
      httpStatus: 401,
      serverDiagnostic: "DESKTOP_SESSION_TOKEN_INVALID",
      serverBuildCommit: "server-commit",
      serverProjectRef: "crmucqnebwlssqzthnek",
      ...fingerprint,
    },
  );

  const diagnostic = mapFailureDiagnostic(error);

  assert.equal(diagnostic?.code, "DESKTOP_SESSION_TOKEN_INVALID");
  assert.equal(diagnostic?.stage, "server-session");
  assert.equal(diagnostic?.httpStatus, 401);
  assert.equal(diagnostic?.serverBuildCommit, "server-commit");
  assert.equal(diagnostic?.clientBuildCommit, "client-commit");
});

test("profile failure surfaces visible code and 500", () => {
  const error = createDesktopAuthError(
    "DESKTOP_API_SESSION_BRIDGE_FAILED",
    "Your Google sign-in succeeded, but dSpeak could not create your app session.",
    {
      stage: "server-session",
      httpStatus: 500,
      serverDiagnostic: "DESKTOP_PROFILE_PROVISION_FAILED",
      responseOrigin: "application",
    },
  );

  const diagnostic = mapFailureDiagnostic(error);

  assert.equal(diagnostic?.code, "DESKTOP_PROFILE_PROVISION_FAILED");
  assert.equal(diagnostic?.httpStatus, 500);
});

test("invalid success payload maps to DESKTOP_SESSION_PAYLOAD_INVALID", () => {
  const error = createDesktopAuthError(
    "DESKTOP_SESSION_PAYLOAD_INVALID",
    "Your Google sign-in succeeded, but dSpeak could not create your app session.",
    {
      stage: "session-payload",
      httpStatus: 200,
      serverDiagnostic: "DESKTOP_SESSION_PAYLOAD_INVALID",
      responseOrigin: "application",
    },
  );

  const diagnostic = mapFailureDiagnostic(error);

  assert.equal(diagnostic?.code, "DESKTOP_SESSION_PAYLOAD_INVALID");
  assert.equal(diagnostic?.stage, "session-payload");
  assert.equal(diagnostic?.httpStatus, 200);
});

test("bare DESKTOP_API_SESSION_BRIDGE_FAILED still renders a diagnostic", () => {
  const error = createDesktopAuthError(
    "DESKTOP_API_SESSION_BRIDGE_FAILED",
    "Your Google sign-in succeeded, but dSpeak could not create your app session.",
  );

  const diagnostic = mapFailureDiagnostic(error);

  assert.deepEqual(diagnostic, {
    code: "DESKTOP_API_SESSION_BRIDGE_FAILED",
    stage: "unknown",
    httpStatus: null,
    serverBuildCommit: "",
    clientBuildCommit: "",
    serverProjectRef: "",
    clientProjectRef: "",
    requestId: "",
    transport: "webview-fetch",
    requestUrl: "",
    responseUrl: "",
    redirected: false,
    statusText: "",
    retryAfter: "",
    serverHeader: "",
    viaHeader: "",
    vercelRequestId: "",
    cloudflareRay: "",
    contentType: "",
    vercelMitigated: "",
    responseOrigin: "unknown",
    provider: "",
  });
});

test("non-native errors map to DESKTOP_AUTH_UNKNOWN_ERROR with no leak", () => {
  const diagnostic = mapFailureDiagnostic(
    new Error("TypeError: failed to fetch"),
  );

  assert.deepEqual(diagnostic, {
    code: "DESKTOP_AUTH_UNKNOWN_ERROR",
    stage: "unknown",
    httpStatus: null,
    serverBuildCommit: "",
    clientBuildCommit: "",
    serverProjectRef: "",
    clientProjectRef: "",
    requestId: "",
    transport: "webview-fetch",
    requestUrl: "",
    responseUrl: "",
    redirected: false,
    statusText: "",
    retryAfter: "",
    serverHeader: "",
    viaHeader: "",
    vercelRequestId: "",
    cloudflareRay: "",
    contentType: "",
    vercelMitigated: "",
    responseOrigin: "unknown",
    provider: "",
  });
});

test("session restore failure carries its own code and stage", () => {
  const error = createDesktopAuthError(
    "DESKTOP_API_SESSION_RESTORE_FAILED",
    "Your Google sign-in succeeded, but dSpeak could not create your app session.",
    { stage: "session-restore" },
  );

  const diagnostic = mapFailureDiagnostic(error);

  assert.equal(diagnostic?.code, "DESKTOP_API_SESSION_RESTORE_FAILED");
  assert.equal(diagnostic?.stage, "session-restore");
  assert.equal(diagnostic?.httpStatus, null);
});

test("unfingerprinted HTTP 429 maps to an upstream edge diagnostic", () => {
  const error = createDesktopAuthError(
    "DESKTOP_API_SESSION_BRIDGE_FAILED",
    "Too Many Requests",
    {
      stage: "server-session",
      httpStatus: 429,
      serverDiagnostic: "Too Many Requests",
    },
  );

  const diagnostic = mapFailureDiagnostic(error);

  assert.equal(diagnostic?.code, "DESKTOP_EDGE_REQUEST_REJECTED");
  assert.equal(diagnostic?.stage, "edge-gateway");
  assert.equal(diagnostic?.httpStatus, 429);
  assert.equal(diagnostic?.responseOrigin, "upstream-edge");
});

test("unfingerprinted HTTP 404 maps to an upstream edge diagnostic", () => {
  const error = createDesktopAuthError(
    "DESKTOP_API_SESSION_BRIDGE_FAILED",
    "Not Found",
    {
      stage: "server-session",
      httpStatus: 404,
      serverDiagnostic: "Not Found",
    },
  );

  const diagnostic = mapFailureDiagnostic(error);

  assert.equal(diagnostic?.code, "DESKTOP_EDGE_REQUEST_REJECTED");
  assert.equal(diagnostic?.stage, "edge-gateway");
  assert.equal(diagnostic?.httpStatus, 404);
  assert.equal(diagnostic?.responseOrigin, "upstream-edge");
});

test("Vercel edge 429 maps to an edge gateway diagnostic", () => {
  const error = createDesktopAuthError(
    "DESKTOP_API_SESSION_BRIDGE_FAILED",
    "Too Many Requests",
    {
      httpStatus: 429,
      serverHeader: "Vercel",
      vercelRequestId: "sin1::request",
      serverDiagnostic: "Too Many Requests",
    },
  );

  const diagnostic = mapFailureDiagnostic(error);

  assert.equal(diagnostic?.code, "DESKTOP_EDGE_RATE_LIMITED");
  assert.equal(diagnostic?.stage, "edge-gateway");
  assert.equal(diagnostic?.responseOrigin, "vercel-edge");
  assert.equal(diagnostic?.provider, "Vercel");
});

test("Vercel challenge response is classified without reading token data", async () => {
  const response = new Response("<html>challenge</html>", {
    status: 429,
    statusText: "Too Many Requests",
    headers: {
      "content-type": "text/html; charset=utf-8",
      server: "Vercel",
      "x-vercel-id": "sin1::request",
      "x-vercel-mitigated": "challenge",
      "retry-after": "30",
    },
  });

  const diagnostic = await readDesktopSessionDiagnostic(
    response,
    "https://dspeak.darelisme.my.id/api/auth/desktop-session",
  );

  assert.equal(diagnostic.responseOrigin, "vercel-edge");
  assert.equal(diagnostic.provider, "Vercel");
  assert.equal(diagnostic.vercelMitigated, "challenge");
  assert.equal(diagnostic.retryAfter, "30");
  assert.equal(diagnostic.contentType, "text/html; charset=utf-8");
});

test("response diagnostics strip credentials and query data from response URLs", async () => {
  const response = new Response("gateway failure", {
    status: 502,
    statusText: "Bad Gateway",
  });
  Object.defineProperty(response, "url", {
    value:
      "https://user:secret@example.com/api/auth/desktop-session?token=secret#fragment",
  });

  const diagnostic = await readDesktopSessionDiagnostic(response);

  assert.equal(
    diagnostic.responseUrl,
    "https://example.com/api/auth/desktop-session",
  );
});

test("fingerprinted application 429 stays an application diagnostic", () => {
  const error = createDesktopAuthError(
    "DESKTOP_API_SESSION_BRIDGE_FAILED",
    "Too Many Requests",
    {
      httpStatus: 429,
      serverHeader: "Vercel",
      vercelRequestId: "sin1::request",
      serverBuildCommit: "server-commit",
      serverProjectRef: "crmucqnebwlssqzthnek",
      serverDiagnostic: "DESKTOP_SESSION_RATE_LIMITED",
    },
  );

  const diagnostic = mapFailureDiagnostic(error);

  assert.equal(diagnostic?.code, "DESKTOP_SESSION_RATE_LIMITED");
  assert.equal(diagnostic?.stage, "unknown");
  assert.equal(diagnostic?.responseOrigin, "application");
});
