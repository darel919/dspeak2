import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import tailwindcss from "@tailwindcss/vite";
import packageMetadata from "../package.json" with { type: "json" };
import { createBuildIdentity } from "../shared/app-build.js";

const desktopDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(desktopDir, "..");
const apiBasePath =
  process.env.VITE_DSPEAK_API_PATH || process.env.DSPEAK_PUBLIC_ORIGIN || "";
const configuredPublicOrigin =
  process.env.DSPEAK_PUBLIC_ORIGIN ||
  process.env.VITE_DSPEAK_PUBLIC_ORIGIN ||
  "";
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
let publicOrigin = configuredPublicOrigin;
try {
  publicOrigin = new URL(publicOrigin).origin;
} catch {
  publicOrigin = "";
}

if (!apiBasePath)
  throw new Error(
    "Desktop API origin is required: set VITE_DSPEAK_API_PATH or DSPEAK_PUBLIC_ORIGIN",
  );
if (!configuredPublicOrigin)
  throw new Error(
    "Desktop public origin is required: set DSPEAK_PUBLIC_ORIGIN",
  );
if (!supabaseUrl || !supabaseAnonKey)
  throw new Error(
    "Desktop Supabase configuration is required: set SUPABASE_URL and SUPABASE_ANON_KEY",
  );

function gitValue(args) {
  try {
    return execFileSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const buildIdentity = createBuildIdentity({
  version: packageMetadata.version,
  commit:
    process.env.DSPEAK_BUILD_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    gitValue(["rev-parse", "--verify", "HEAD"]),
  branch:
    process.env.DSPEAK_BUILD_BRANCH ||
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.GITHUB_REF_NAME ||
    gitValue(["symbolic-ref", "--short", "-q", "HEAD"]),
  builtAt: process.env.DSPEAK_BUILD_TIME || new Date().toISOString(),
  repository: process.env.DSPEAK_UPDATE_REPOSITORY,
  updateBranch: process.env.DSPEAK_UPDATE_BRANCH,
});

export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: "2025-07-15",

  rootDir,
  srcDir: resolve(rootDir, "app"),
  serverDir: resolve(desktopDir, "server"),
  alias: {
    "@": resolve(rootDir, "app"),
    "~": resolve(rootDir, "app"),
    "@@": rootDir,
    "~~": rootDir,
    "@legal": resolve(rootDir, "docs"),
  },
  dir: {
    public: resolve(desktopDir, "public"),
    shared: resolve(rootDir, "shared"),
  },

  modules: ["@pinia/nuxt", "@nuxt/icon"],
  css: [resolve(rootDir, "app/assets/app.css")],
  devtools: false,

  nitro: {
    rootDir,
    output: {
      dir: resolve(desktopDir, ".output"),
    },
  },
  pwa: false,

  app: {
    baseURL: "/",
    buildAssetsDir: "/_nuxt/",
  },

  vite: {
    plugins: [tailwindcss()],
  },

  runtimeConfig: {
    public: {
      baseApiPath: apiBasePath,
      publicOrigin,
      sfuPath: process.env.VITE_DSPEAK_SFU_PATH || "",
      apiPath: `${apiBasePath.replace(/\/$/, "")}/api`,
      supabaseUrl,
      supabaseAnonKey,
      appVersion: buildIdentity.version,
      appBuild: buildIdentity,
      VAPID_PUBLIC_KEY:
        process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBKEY,
    },
  },

  icon: {
    provider: "server",
    serverBundle: {
      collections: ["lucide"],
    },
  },
  security: false,
});
