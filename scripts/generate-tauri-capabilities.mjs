import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const capabilityPath = join(
  projectRoot,
  "desktop",
  "src-tauri",
  "capabilities",
  "generated-api.json",
);

function rootEnvValue(name) {
  try {
    const line = readFileSync(join(projectRoot, ".env"), "utf8")
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

function configuredValue(name) {
  return process.env[name] || rootEnvValue(name);
}

function originFrom(value, label) {
  try {
    const url = new URL(value);
    if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error();
    return url.origin;
  } catch {
    throw new Error(`${label} must be an HTTP or HTTPS URL`);
  }
}

const apiOrigin = originFrom(
  configuredValue("VITE_DSPEAK_API_PATH") ||
    configuredValue("DSPEAK_PUBLIC_ORIGIN"),
  "VITE_DSPEAK_API_PATH or DSPEAK_PUBLIC_ORIGIN",
);
const publicOrigin = originFrom(
  configuredValue("DSPEAK_PUBLIC_ORIGIN"),
  "DSPEAK_PUBLIC_ORIGIN",
);
const configuredSupabaseUrl = configuredValue("SUPABASE_URL");
const supabaseOrigin = originFrom(configuredSupabaseUrl, "SUPABASE_URL");

const capability = {
  identifier: "generated-api",
  description:
    "Generated scopes for the dSpeak hosted API and external sign-in URLs",
  windows: ["main"],
  permissions: [
    {
      identifier: "http:default",
      allow: [{ url: `${apiOrigin}/api/**` }],
    },
    {
      identifier: "opener:allow-open-url",
      allow: [
        { url: `${publicOrigin}/terms` },
        { url: `${publicOrigin}/privacy` },
        { url: `${supabaseOrigin}/auth/v1/**` },
      ],
    },
  ],
};

mkdirSync(join(projectRoot, "desktop", "src-tauri", "capabilities"), {
  recursive: true,
});
writeFileSync(
  capabilityPath,
  `${JSON.stringify(capability, null, 2)}\n`,
  "utf8",
);
console.log(`Generated Tauri API scopes for ${apiOrigin}`);
