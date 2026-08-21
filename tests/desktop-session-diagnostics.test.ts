import assert from "node:assert/strict";
import test from "node:test";
import { readDesktopSessionDiagnostic } from "../app/shared/desktop-session-diagnostics.ts";

test("desktop session diagnostics preserve the server category and build", async () => {
  const response = new Response(
    JSON.stringify({ statusMessage: "DESKTOP_SESSION_TOKEN_INVALID" }),
    {
      status: 401,
      statusText: "Unauthorized",
      headers: {
        "X-dSpeak-Build-Commit": "server-commit",
        "X-dSpeak-Supabase-Project": "crmucqnebwlssqzthnek",
        "retry-after": "60",
        server: "Vercel",
        via: "1.1 edge",
        "x-vercel-id": "sin1::request-123",
        "cf-ray": "abc123-SIN",
      },
    },
  );
  Object.defineProperties(response, {
    url: { value: "https://api.dspeak.example/api/auth/desktop-session" },
    redirected: { value: true },
  });

  const diagnostic = await readDesktopSessionDiagnostic(
    response,
    "https://app.dspeak.example/api/auth/desktop-session",
  );

  assert.deepEqual(diagnostic, {
    diagnosticCategory: "DESKTOP_SESSION_TOKEN_INVALID",
    serverBuildCommit: "server-commit",
    httpStatus: 401,
    serverProjectRef: "crmucqnebwlssqzthnek",
    requestUrl: "https://app.dspeak.example/api/auth/desktop-session",
    responseUrl: "https://api.dspeak.example/api/auth/desktop-session",
    redirected: true,
    statusText: "Unauthorized",
    retryAfter: "60",
    serverHeader: "Vercel",
    viaHeader: "1.1 edge",
    vercelRequestId: "sin1::request-123",
    cloudflareRay: "abc123-SIN",
  });
});

test("desktop session diagnostics fall back safely for non-JSON responses", async () => {
  const response = new Response("gateway failure", {
    status: 502,
    statusText: "Bad Gateway",
  });

  const diagnostic = await readDesktopSessionDiagnostic(response);

  assert.deepEqual(diagnostic, {
    diagnosticCategory: "Bad Gateway",
    serverBuildCommit: "",
    httpStatus: 502,
    serverProjectRef: "",
    requestUrl: "",
    responseUrl: "",
    redirected: false,
    statusText: "Bad Gateway",
    retryAfter: "",
    serverHeader: "",
    viaHeader: "",
    vercelRequestId: "",
    cloudflareRay: "",
  });
});
