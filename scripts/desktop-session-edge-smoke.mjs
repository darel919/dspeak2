#!/usr/bin/env node

const defaultOrigin = "https://dspeak.darelisme.my.id";
const endpointPath = "/api/auth/desktop-session";
const expectedDiagnostic = "DESKTOP_SESSION_MISSING_BEARER";

class SmokeFailure extends Error {
  constructor(reason, status = null) {
    super(reason);
    this.reason = reason;
    this.status = status;
  }
}

function readOrigin() {
  const configured = (process.env.DSPEAK_PUBLIC_ORIGIN || defaultOrigin).trim();
  try {
    const url = new URL(configured);
    if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error();
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new SmokeFailure(
      "DSPEAK_PUBLIC_ORIGIN must be an HTTP or HTTPS origin",
    );
  }
}

function readRecord(value) {
  try {
    return Object.getPrototypeOf(value) === Object.prototype ? value : null;
  } catch {
    return null;
  }
}

function readHeader(response, name) {
  return response.headers.get(name)?.trim() || "";
}

function validBuildCommit(value) {
  return /^[0-9a-f]{7,40}$/.test(value);
}

function validProjectRef(value) {
  return /^[a-z0-9]{1,63}$/.test(value);
}

function printProvenance({
  origin,
  response,
  diagnostic,
  buildCommit,
  projectRef,
}) {
  console.log(`dSpeak desktop auth edge smoke: ${origin}${endpointPath}`);
  console.log(`  status: ${response.status}`);
  console.log(`  diagnostic: ${diagnostic}`);
  console.log(`  build commit: ${buildCommit || "(missing)"}`);
  console.log(`  Supabase project: ${projectRef || "(missing)"}`);
}

async function runSmoke() {
  const origin = readOrigin();
  const endpoint = `${origin}${endpointPath}`;
  let response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: origin,
        "Sec-Fetch-Site": "same-origin",
      },
      body: "{}",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new SmokeFailure("edge request did not complete");
  }

  const buildCommit = readHeader(response, "X-dSpeak-Build-Commit");
  const projectRef = readHeader(response, "X-dSpeak-Supabase-Project");
  const contentType = readHeader(response, "content-type").toLowerCase();
  const vercelMitigation = readHeader(
    response,
    "x-vercel-mitigated",
  ).toLowerCase();
  const hasChallengeHeader = response.headers.has("x-vercel-challenge-token");
  const hasRedirect = response.redirected || response.headers.has("location");
  const body = await response.text();
  const bodyStart = body.trimStart().slice(0, 256).toLowerCase();
  const isHtml =
    contentType.includes("text/html") ||
    bodyStart.startsWith("<!doctype html") ||
    bodyStart.startsWith("<html") ||
    bodyStart.startsWith("<head") ||
    bodyStart.startsWith("<body");

  if (hasRedirect)
    throw new SmokeFailure("edge response redirected", response.status);
  if (response.status === 429)
    throw new SmokeFailure("edge response was rate limited", 429);
  if (vercelMitigation === "challenge" || hasChallengeHeader)
    throw new SmokeFailure(
      "edge response was a Vercel challenge",
      response.status,
    );
  if (isHtml) throw new SmokeFailure("edge response was HTML", response.status);
  if (response.status !== 401)
    throw new SmokeFailure(
      "edge response was not the application 401",
      response.status,
    );
  if (!contentType.startsWith("application/json"))
    throw new SmokeFailure(
      "edge response was not application JSON",
      response.status,
    );

  let payload;
  try {
    payload = readRecord(JSON.parse(body));
  } catch {
    throw new SmokeFailure(
      "edge response was not valid application JSON",
      response.status,
    );
  }
  const diagnosticValue = payload?.statusMessage;
  const diagnostic =
    Object.prototype.toString.call(diagnosticValue) === "[object String]"
      ? diagnosticValue
      : "";
  if (diagnostic !== expectedDiagnostic)
    throw new SmokeFailure(
      "edge response had the wrong application diagnostic",
      response.status,
    );
  if (!validBuildCommit(buildCommit))
    throw new SmokeFailure(
      "edge response omitted a valid build fingerprint",
      response.status,
    );
  if (!validProjectRef(projectRef))
    throw new SmokeFailure(
      "edge response omitted a valid Supabase fingerprint",
      response.status,
    );

  printProvenance({ origin, response, diagnostic, buildCommit, projectRef });
  console.log("  result: pass");
}

try {
  await runSmoke();
} catch (error) {
  if (error instanceof SmokeFailure) {
    console.error(
      `dSpeak desktop auth edge smoke failed: ${error.reason}${
        error.status === null ? "" : ` (HTTP ${error.status})`
      }`,
    );
  } else {
    console.error(
      "dSpeak desktop auth edge smoke failed: unexpected probe error",
    );
  }
  process.exitCode = 1;
}
