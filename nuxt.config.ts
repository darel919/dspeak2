import tailwindcss from "@tailwindcss/vite";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import packageMetadata from "./package.json" with { type: "json" };

function copyMediasoupWorker(nitro) {
  if (nitro.options.dev) return;

  const source = resolve(
    "node_modules/mediasoup/worker/out/Release/mediasoup-worker",
  );
  const destination = resolve(
    nitro.options.output.serverDir,
    "node_modules/mediasoup/worker/out/Release/mediasoup-worker",
  );
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  chmodSync(destination, 0o755);
}

export default defineNuxtConfig({
  ssr: true,
  compatibilityDate: "2025-07-15",
  devtools: { enabled: false },

  vite: {
    plugins: [tailwindcss()],
  },

  css: ["~/assets/app.css"],
  modules: ["@pinia/nuxt", "@vite-pwa/nuxt", "@nuxt/icon"],

  icon: {
    provider: "server",
    serverBundle: {
      collections: ["lucide"],
    },
  },

  nitro: {
    externals: {
      inline: [resolve("shared")],
    },
    experimental: {
      websocket: true,
    },
    hooks: {
      compiled: copyMediasoupWorker,
    },
  },

  pwa: {
    strategies: "injectManifest",
    srcDir: "../public",
    filename: "sw.js",
    registerType: "prompt",
    injectRegister: false,
    injectManifest: {
      globPatterns: ["**/*.{js,css,json,png,svg,ico,woff,woff2,webmanifest}"],
      rollupFormat: "es",
    },
    client: {
      installPrompt: true,
    },

    manifest: {
      id: "/",
      name: "dSpeak",
      short_name: "dSpeak",
      description: "DWS communication app.",
      start_url: "/",
      scope: "/",
      theme_color: "#4A90E2",
      background_color: "#FFFFFF",
      display: "standalone",
      orientation: "portrait",
      icons: [
        {
          src: "/android-chrome-192x192.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: "/android-chrome-512x512.png",
          sizes: "512x512",
          type: "image/png",
        },
      ],
    },
    devOptions: {
      enabled: true,
      type: "module",
    },
  },

  runtimeConfig: {
    pocketbase: {
      url: process.env.POCKETBASE_URL || "",
      adminEmail: process.env.PBASE_ADMIN_EMAIL || "",
      adminPassword: process.env.PBASE_ADMIN_PASSWORD || "",
      vapidPublicKey:
        process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBKEY || "",
      vapidPrivateKey: process.env.VAPID_PRIVKEY || "",
    },
    mediasoup: {
      listenIp: process.env.MEDIASOUP_LISTEN_IP || "127.0.0.1",
      announcedAddress: process.env.MEDIASOUP_ANNOUNCED_ADDRESS || "",
      rtcPort: Number(process.env.MEDIASOUP_RTC_PORT || 40000),
      announcedPort: Number(
        process.env.MEDIASOUP_ANNOUNCED_PORT ||
          process.env.MEDIASOUP_RTC_PORT ||
          40000,
      ),
      directAddress: process.env.MEDIASOUP_DIRECT_ADDRESS || "",
      directPort: Number(
        process.env.MEDIASOUP_DIRECT_PORT ||
          process.env.MEDIASOUP_RTC_PORT ||
          40000,
      ),
      maxClientOutgoingBitrate: Number(
        process.env.MEDIASOUP_MAX_CLIENT_OUTGOING_BITRATE || 4500000,
      ),
      maxServerOutgoingBitrate: Number(
        process.env.MEDIASOUP_MAX_SERVER_OUTGOING_BITRATE || 40000000,
      ),
    },
    public: {
      authPath: process.env.AUTH_PATH,
      websocketPath: "",
      baseApiPath: process.env.AUTH_PATH?.replace(/\/auth\/?$/, "") || "",
      sfuPath: "",
      apiPath: "/dspeak",
      appVersion: packageMetadata.version,
      VAPID_PUBLIC_KEY:
        process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBKEY,
    },
  },
});
