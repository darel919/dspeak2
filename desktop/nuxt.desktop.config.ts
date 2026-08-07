import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";

const desktopDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(desktopDir, "..");
const apiBasePath = process.env.VITE_DSPEAK_API_PATH || "";

export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: "2025-07-15",

  rootDir,
  srcDir: resolve(rootDir, "app"),
  serverDir: resolve(rootDir, "server"),
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
      websocketPath: "",
      baseApiPath: apiBasePath,
      sfuPath: process.env.VITE_DSPEAK_SFU_PATH || "",
      apiPath: process.env.VITE_DSPEAK_API_PATH
        ? `${process.env.VITE_DSPEAK_API_PATH.replace(/\/$/, "")}/api`
        : "/api",
      appVersion: "",
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
