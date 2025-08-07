// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },

  vite: {
    plugins: [tailwindcss()],
  },

  css: ["~/assets/app.css"],
  modules: ["@pinia/nuxt", "@vite-pwa/nuxt"],

  pwa: {
    strategies: 'injectManifest',
    srcDir: '../public',
    filename: 'sw.js',
    registerType: 'autoUpdate',
    // injectManifest: {
    //   swSrc: 'sw.js',
    //   swDest: 'sw.js'
    // },
    manifest: {
      name: "dSpeak",
      short_name: "dSpeak",
      description: "DWS communication app.",
      theme_color: "#4A90E2",
      background_color: "#FFFFFF",
      display: "standalone",
      orientation: "portrait",
      icons: [
        {
          src: "/android-chrome-192x192.png",
          sizes: "192x192",
          type: "image/png"
        },
        {
          src: "/android-chrome-512x512.png",
          sizes: "512x512",
          type: "image/png"
        }
      ]
    },
    devOptions: {
      enabled: true
    }
  },

  runtimeConfig: {
    public: {
      authPath: process.env.AUTH_PATH,
      websocketPath: process.env.NODE_ENV === 'production' ? `wss://${process.env.BASE_API_EXT}${process.env.BASE_PATH}` : `ws://${process.env.BASE_API}${process.env.BASE_PATH}`,
      apiPath: process.env.NODE_ENV === 'production' ? `https://${process.env.BASE_API_EXT}${process.env.BASE_PATH}` : `http://${process.env.BASE_API}${process.env.BASE_PATH}`,
      VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY
    }
  }
})