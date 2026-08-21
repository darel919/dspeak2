import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopAuthError } from "../app/shared/desktop-auth-error.ts";
import { mapFailureDiagnostic } from "../app/shared/desktop-session-diagnostics.ts";

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

test("unknown HTTP 429 maps to DESKTOP_API_SESSION_HTTP_429", () => {
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

  assert.equal(diagnostic?.code, "DESKTOP_API_SESSION_HTTP_429");
  assert.equal(diagnostic?.stage, "server-session");
  assert.equal(diagnostic?.httpStatus, 429);
});

test("unknown HTTP 404 maps to DESKTOP_API_SESSION_HTTP_404", () => {
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

  assert.equal(diagnostic?.code, "DESKTOP_API_SESSION_HTTP_404");
  assert.equal(diagnostic?.stage, "server-session");
  assert.equal(diagnostic?.httpStatus, 404);
});
