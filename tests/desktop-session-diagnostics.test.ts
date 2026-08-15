import assert from "node:assert/strict";
import test from "node:test";
import { readDesktopSessionDiagnostic } from "../app/shared/desktop-session-diagnostics.ts";

test("desktop session diagnostics preserve the server category and build", async () => {
  const response = new Response(
    JSON.stringify({ statusMessage: "DESKTOP_SESSION_TOKEN_INVALID" }),
    {
      status: 401,
      headers: { "X-dSpeak-Build-Commit": "server-commit" },
    },
  );

  const diagnostic = await readDesktopSessionDiagnostic(response);

  assert.deepEqual(diagnostic, {
    diagnosticCategory: "DESKTOP_SESSION_TOKEN_INVALID",
    serverBuildCommit: "server-commit",
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
  });
});
