import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  devtools: { enabled: true },

  nitro: {
    preset: 'cloudflare_module',

    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
      wrangler: {
        name: 't3-cloneathon',
      },
    },
  },

  modules: [
    'nitro-cloudflare-dev',
    '@nuxt/eslint',
    '@nuxt/fonts',
    '@nuxt/icon',
  ],
  eslint: {
    checker: true,
  },
  fonts: {
    defaults: {
      weights: [400, 700],
      styles: ['normal'],
    },
    provider: 'google',
  },
  icon: {
    serverBundle: {
      collections: ['lucide'],
    },
  },
  future: {
    compatibilityVersion: 4,
  },
  typescript: {
    typeCheck: true,
  },
  vite: {
    plugins: [tailwindcss()],
  },
  css: ['./assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: {
        lang: 'en',
      },
      meta: [
        { name: 'description', content: 'A Nuxt 3 project' },
      ],
    },
  },
})
