import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";

const desktopDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(desktopDir, "..");

export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: "2025-07-15",

  srcDir: resolve(rootDir, "app"),
  serverDir: resolve(rootDir, "server"),

  modules: [],
  css: [resolve(rootDir, "app/assets/app.css")],
  devtools: false,

  nitro: false,
  pwa: false,

  app: {
    baseURL: "/",
    buildAssetsDir: "/_nuxt/",
  },

  vite: {
    plugins: [tailwindcss()],
  },

  icon: false,
  security: false,
});
