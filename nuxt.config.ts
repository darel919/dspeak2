// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from "@tailwindcss/vite";
export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  vite: {
    plugins: [tailwindcss()],
  },

  css: ["~/assets/app.css"],
  modules: ["@pinia/nuxt"],

  runtimeConfig: {
    public: {
      authPath: process.env.AUTH_PATH
    }
  }
})