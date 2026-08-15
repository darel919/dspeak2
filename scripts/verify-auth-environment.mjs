#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

function envValue(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(join(process.cwd(), ".env"), "utf8")
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find(
        (value) =>
          value.startsWith(`${name}=`) || value.startsWith(`export ${name}=`),
      );
    if (!line) return "";
    const value = line.slice(line.indexOf("=") + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))
      return value.slice(1, -1);
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'"))
      return value.slice(1, -1);
    return value;
  } catch {
    return "";
  }
}

function supabaseProjectRef(url) {
  try {
    return new URL(url).hostname.split(".")[0] || "";
  } catch {
    return "";
  }
}

function keyProjectRef(key) {
  try {
    const payload = key.split(".")[1];
    if (!payload) return "";
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    return typeof claims.ref === "string" ? claims.ref : "";
  } catch {
    return "";
  }
}

function normalizeOrigin(value, label) {
  try {
    const url = new URL(value);
    if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error();
    return url.origin;
  } catch {
    console.error(`✗ ${label} must be an HTTP or HTTPS URL`);
    process.exitCode = 1;
    return "";
  }
}

const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];
const serverOnly = ["SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"];
const missing = required.filter((name) => !envValue(name));
const missingServerOnly = serverOnly.filter((name) => !envValue(name));
if (missing.length > 0) {
  console.error(`✗ Missing environment variables: ${missing.join(", ")}`);
  process.exitCode = 1;
}
if (missingServerOnly.length > 0) {
  console.warn(
    `⚠ Server-only variables not set (expected outside Vercel runtime): ${missingServerOnly.join(", ")}`,
  );
}

const supabaseUrl = envValue("SUPABASE_URL");
const supabaseProject = supabaseProjectRef(supabaseUrl);
const anonKey = envValue("SUPABASE_ANON_KEY");
const serviceRoleKey = envValue("SUPABASE_SERVICE_ROLE_KEY");
const anonKeyProject = keyProjectRef(anonKey);
const serviceKeyProject = keyProjectRef(serviceRoleKey);
const publicOrigin = normalizeOrigin(
  envValue("DSPEAK_PUBLIC_ORIGIN") || "https://dspeak.darelisme.my.id",
  "DSPEAK_PUBLIC_ORIGIN",
);
const apiOrigin = normalizeOrigin(
  envValue("VITE_DSPEAK_API_PATH") || publicOrigin,
  "VITE_DSPEAK_API_PATH",
);

console.log("dSpeak auth environment (non-secret fingerprints only):");
console.log(`  API origin:       ${apiOrigin}`);
console.log(`  Public origin:    ${publicOrigin}`);
console.log(`  Supabase project: ${supabaseProject || "(unset)"}`);
console.log(
  `  Normalized URL:   ${supabaseUrl ? new URL(supabaseUrl).origin : "(unset)"}`,
);
console.log(`  Anon key project: ${anonKeyProject || "(not a JWT)"}`);
console.log(
  `  Service-role project: ${serviceKeyProject || "(not set or not a JWT)"}`,
);

if (supabaseProject && anonKeyProject && supabaseProject !== anonKeyProject) {
  console.error(
    `✗ SUPABASE_ANON_KEY belongs to ${anonKeyProject}, but SUPABASE_URL is ${supabaseProject}`,
  );
  process.exitCode = 1;
}
if (
  supabaseProject &&
  serviceKeyProject &&
  supabaseProject !== serviceKeyProject
) {
  console.error(
    `✗ SUPABASE_SERVICE_ROLE_KEY belongs to ${serviceKeyProject}, but SUPABASE_URL is ${supabaseProject}`,
  );
  process.exitCode = 1;
}

if (!supabaseProject) {
  console.error("✗ SUPABASE_URL is not a valid project URL");
  process.exitCode = 1;
}
if (supabaseUrl && supabaseUrl !== new URL(supabaseUrl).origin) {
  console.warn(
    `  Note: SUPABASE_URL contains a trailing slash or path; normalized to ${new URL(supabaseUrl).origin}`,
  );
}

console.log(
  process.exitCode
    ? "✗ Auth environment has problems."
    : "✓ Auth environment looks consistent.",
);
process.exit(process.exitCode || 0);
