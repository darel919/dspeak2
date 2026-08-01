import tailwindcss from "@tailwindcss/vite";
import { mkdirSync, cpSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import packageMetadata from "./package.json" with { type: "json" };

const isProduction = process.env.NODE_ENV === "production";
const isDesktop = process.env.DSPEAK_DESKTOP === "1";
const desktopApiBasePath =
  process.env.VITE_DSPEAK_API_PATH ||
  process.env.AUTH_PATH?.replace(/\/auth\/?$/, "") ||
  "";
const desktopSfuPath = process.env.VITE_DSPEAK_SFU_PATH || "";

function copyWsModule(nitro) {
  if (nitro.options.dev) return;

  const src = resolve("node_modules/ws");
  const dest = resolve(nitro.options.output.serverDir, "node_modules/ws");
  if (!existsSync(dest) && existsSync(src)) {
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, force: true });
    console.log("[nitro] Copied ws module to output");
  }
}

export default defineNuxtConfig({
  ssr: !isDesktop,
  compatibilityDate: "2025-07-15",
  devtools: { enabled: !isProduction && !isDesktop },
  dir: isDesktop ? { public: resolve("desktop/public") } : undefined,
  app: {
    head: {
      htmlAttrs: {
        lang: "en",
      },
    },
  },

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@legal": resolve("docs"),
      },
    },
  },

  css: ["~/assets/app.css"],
  modules: isDesktop
    ? ["@pinia/nuxt", "@nuxt/icon"]
    : ["@pinia/nuxt", "@vite-pwa/nuxt", "@nuxt/icon", "nuxt-security"],

  security: {
    strict: true,
    headers: {
      crossOriginResourcePolicy: "same-origin",
      crossOriginOpenerPolicy: "same-origin",
      crossOriginEmbedderPolicy: "credentialless",
      contentSecurityPolicy: isProduction
        ? {
            "default-src": ["'self'"],
            "base-uri": ["'none'"],
            "connect-src": ["'self'"],
            "font-src": ["'self'", "data:"],
            "form-action": ["'self'"],
            "frame-ancestors": ["'none'"],
            "frame-src": ["'none'"],
            "img-src": ["'self'", "data:", "blob:", "https://*.mzstatic.com"],
            "manifest-src": ["'self'"],
            "media-src": ["'self'", "blob:"],
            "object-src": ["'none'"],
            "require-trusted-types-for": ["'script'"],
            "script-src": [
              "'strict-dynamic'",
              "'nonce-{{nonce}}'",
              "'report-sample'",
            ],
            "script-src-attr": ["'none'"],
            "style-src": ["'self'", "'unsafe-inline'", "'report-sample'"],
            "style-src-attr": ["'unsafe-inline'"],
            "trusted-types": ["vue", "dspeak-service-worker"],
            "worker-src": ["'self'", "blob:"],
            "upgrade-insecure-requests": true,
            "report-to": ["csp-endpoint"],
          }
        : false,
      originAgentCluster: "?1",
      referrerPolicy: "strict-origin-when-cross-origin",
      strictTransportSecurity: isProduction
        ? {
            maxAge: 31536000,
            includeSubdomains: true,
            preload: true,
          }
        : false,
      xContentTypeOptions: "nosniff",
      xDNSPrefetchControl: "off",
      xDownloadOptions: "noopen",
      xFrameOptions: "DENY",
      xPermittedCrossDomainPolicies: "none",
      xXSSProtection: "0",
      permissionsPolicy: {
        autoplay: ["self"],
        camera: ["self"],
        "display-capture": ["self"],
        fullscreen: ["self"],
        geolocation: [],
        microphone: ["self"],
        "screen-wake-lock": ["self"],
      },
    },
    requestSizeLimiter: {
      maxRequestSizeInBytes: 2_000_000,
      maxUploadFileRequestInBytes: 8_000_000,
      throwError: true,
    },
    rateLimiter: false,
    xssValidator: false,
    corsHandler: false,
    allowedMethodsRestricter: false,
    hidePoweredBy: true,
    nonce: true,
    ssg: false,
    sri: true,
    basicAuth: false,
    csrf: false,
    removeLoggers: false,
    contentSecurityPolicyReportOnly: false,
  },

  routeRules: {
    "/**": {
      headers: isProduction
        ? {
            "Reporting-Endpoints": 'csp-endpoint="/api/security/csp-report"',
          }
        : {},
    },
    "/sw.js": {
      headers: {
        "Cache-Control": "no-cache",
        "CDN-Cache-Control": "no-store",
        "Cloudflare-CDN-Cache-Control": "no-store",
      },
    },
  },

  icon: {
    provider: "server",
    serverBundle: {
      collections: ["lucide"],
    },
  },

  nitro: {
    sourceMap: false,
    externals: {
      inline: [resolve("shared")],
      traceInclude: [
        resolve("node_modules/mediasoup/worker/out/Release/mediasoup-worker"),
      ],
    },
    experimental: {
      websocket: true,
    },
    hooks: {
      compiled: (nitro) => {
        copyWsModule(nitro);
      },
    },
  },

  pwa: isDesktop
    ? false
    : {
        strategies: "injectManifest",
        srcDir: "../public",
        filename: "sw.js",
        registerType: "prompt",
        injectRegister: false,
        injectManifest: {
          globPatterns: ["**/*.{js,css,json,png,svg,ico,woff,woff2}"],
          rollupFormat: "es",
        },
        client: {
          registerPlugin: false,
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
      baseApiPath: isDesktop
        ? desktopApiBasePath
        : process.env.AUTH_PATH?.replace(/\/auth\/?$/, "") || "",
      sfuPath: isDesktop ? desktopSfuPath : "",
      apiPath:
        isDesktop && process.env.VITE_DSPEAK_API_PATH
          ? `${process.env.VITE_DSPEAK_API_PATH.replace(/\/$/, "")}/api`
          : "/api",
      appVersion: packageMetadata.version,
      VAPID_PUBLIC_KEY:
        process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBKEY,
    },
  },
});
