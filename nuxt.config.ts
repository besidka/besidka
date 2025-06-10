import tailwindcss from '@tailwindcss/vite'

const {
  DB_ID,
  DB_PREVIEW_ID,
  KV_ID,
  KV_PREVIEW_ID,
  RESEND_API_KEY,
  RESEND_FROM_NOREPLY,
  RESEND_FROM_PERSONALIZED,
  BETTER_AUTH_SECRET,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
} = process.env

const isDev = !!import.meta.dev
const isProd = !isDev

export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  devtools: { enabled: isDev },
  nitro: {
    preset: 'cloudflare_module',
    experimental: {
      asyncContext: true,
    },
    cloudflare: {
      deployConfig: isProd,
      nodeCompat: true,
      wrangler: {
        name: 't3-cloneathon',
        d1_databases: [
          {
            binding: 'DB',
            database_name: 't3-cloneathon',
            database_id: DB_ID || '__SET__DB_ID__IN_ENV__',
            preview_database_id: DB_PREVIEW_ID || '__SET__DB_PREVIEW_ID__IN_ENV__',
            migrations_dir: '.drizzle/migrations',
          },
        ],
        kv_namespaces: [
          {
            binding: 'KV',
            id: KV_ID || '__SET_KV_ID__IN_ENV__',
            preview_id: KV_PREVIEW_ID || '__SET__KV_PREVIEW_ID__IN_ENV__',
          },
        ],
      },
    },
  },
  runtimeConfig: {
    drizzle: {
      debug: isDev,
    },
    resend: {
      apiKey: RESEND_API_KEY || '__SET__RESEND_API_KEY__IN_ENV__',
      sender: {
        'no-reply': RESEND_FROM_NOREPLY || '__SET__RESEND_FROM_NOREPLY__IN_ENV__',
        'personalized': RESEND_FROM_PERSONALIZED || '__SET__RESEND_FROM_PERSONALIZED__IN_ENV__',
      },
    },
    betterAuth: {
      secret: BETTER_AUTH_SECRET || '__SET__BETTER_AUTH_SECRET__IN_ENV__',
      providers: {
        google: {
          clientId: GOOGLE_CLIENT_ID || '__SET__GOOGLE_CLIENT_ID__IN_ENV__',
          clientSecret: GOOGLE_CLIENT_SECRET || '__SET__GOOGLE_CLIENT_SECRET__IN_ENV__',
        },
        github: {
          clientId: GITHUB_CLIENT_ID || '__SET__GITHUB_CLIENT_ID__IN_ENV__',
          clientSecret: GITHUB_CLIENT_SECRET || '__SET__GITHUB_CLIENT_SECRET__IN_ENV__',
        },
      },
    },
  },
  colorMode: {
    dataValue: 'theme',
  },
  modules: [
    'nitro-cloudflare-dev',
    '@nuxt/eslint',
    '@nuxt/fonts',
    '@nuxt/icon',
    '@nuxt/image',
    '@nuxtjs/color-mode',
    '@nuxtjs/device',
    '@vueuse/nuxt',
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
      collections: ['lucide', 'mdi'],
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
        {
          name: 'description',
          content: 'Open-source AI chat application. Bring your API key and start chatting with available LLMs!',
        },
      ],
    },
  },
  experimental: {
    componentIslands: true,
  },
})
