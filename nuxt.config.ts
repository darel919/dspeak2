import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import packageMetadata from "./package.json" with { type: "json" };

const isProduction = process.env.NODE_ENV === "production";
const isDesktop = process.env.DSPEAK_DESKTOP === "1";
const desktopApiBasePath = process.env.VITE_DSPEAK_API_PATH || "";

const connectSources = [process.env.MEDIA_CONTROL_URL, process.env.SUPABASE_URL]
  .filter(Boolean)
  .flatMap((value) => {
    try {
      const url = new URL(value);
      const websocketProtocol = url.protocol === "https:" ? "wss:" : "ws:";
      return [url.origin, `${websocketProtocol}//${url.host}`];
    } catch {
      return [];
    }
  });

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
            "connect-src": ["'self'", ...connectSources],
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
    public: {
      websocketPath: "",
      baseApiPath: isDesktop ? desktopApiBasePath : "",

      mediaControlUrl: process.env.MEDIA_CONTROL_URL || "",
      apiPath:
        isDesktop && process.env.VITE_DSPEAK_API_PATH
          ? `${process.env.VITE_DSPEAK_API_PATH.replace(/\/$/, "")}/api`
          : "/api",
      appVersion: packageMetadata.version,
      VAPID_PUBLIC_KEY:
        process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBKEY,
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    },
  },
});
