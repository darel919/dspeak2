import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("copied RTC reports retain protocol lifecycle and readiness evidence", async () => {
  const source = await readFile(
    new URL("../app/stores/rtc-stats.js", import.meta.url),
    "utf8",
  );
  const reportStart = source.indexOf("async function createDiagnosticReport()");
  const reportEnd = source.indexOf("\n  function appendHistory", reportStart);
  const reportSource = source.slice(reportStart, reportEnd);

  assert.match(reportSource, /protocol: currentSnapshot\.protocol \|\| null/);
  assert.match(reportSource, /lifecycle: currentSnapshot\.lifecycle \|\| \[\]/);
  assert.match(reportSource, /readiness: currentSnapshot\.readiness \|\| null/);
  assert.match(reportSource, /diagnosticErrors/);
  assert.match(reportSource, /collectOptional/);
});
