import tailwindcss from '@tailwindcss/vite'
import providers from './providers'

const providerValues = Object.values(providers)
const defaultFirstFoundModel = providerValues[0]?.models[0]?.id
let defaultMarkedModel: string = ''

for (const provider of providerValues) {
  for (const model of provider.models) {
    // @ts-expect-error
    if (model.default) {
      defaultMarkedModel = model.id
      break
    }
  }
}

const defaultModel = defaultMarkedModel ?? defaultFirstFoundModel

const {
  BASE_URL,
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
  HASHIDS_SECRET,
  ENCRYPTION_SECRET,
} = process.env

const isDev = !!import.meta.dev
const isProd = !isDev
const enableAllLogs = false

export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  devtools: { enabled: isDev },
  features: {
    devLogs: enableAllLogs,
  },
  nitro: {
    debug: enableAllLogs,
    preset: 'cloudflare_module',
    experimental: {
      asyncContext: true,
    },
    cloudflare: {
      deployConfig: isProd,
      nodeCompat: true,
      wrangler: {
        name: 'chat',
        observability: {
          enabled: true,
          head_sampling_rate: 1,
        },
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'chat',
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
  $development: {
    routeRules: {
      '/.well-known/appspecific/**': {
        headers: { 'cache-control': 'max-age=31536000' },
        redirect: { to: '/', statusCode: 404 },
      },
      '/__webpack_hmr/**': {
        headers: { 'cache-control': 'max-age=31536000' },
        redirect: { to: '/', statusCode: 404 },
      },
    },
    runtimeConfig: {
      drizzle: {
        debug: true,
      },
    },
  },
  runtimeConfig: {
    encryption: {
      hashids: HASHIDS_SECRET || '__SET__HASHIDS_SECRET__IN_ENV__',
      key: ENCRYPTION_SECRET || '__SET__ENCRYPTION_SECRET__IN_ENV__',
    },
    resend: {
      apiKey: RESEND_API_KEY || '__SET__RESEND_API_KEY__IN_ENV__',
      sender: {
        noreply: RESEND_FROM_NOREPLY || '__SET__RESEND_FROM_NOREPLY__IN_ENV__',
        personalized: RESEND_FROM_PERSONALIZED || '__SET__RESEND_FROM_PERSONALIZED__IN_ENV__',
      },
    },
    betterAuth: {
      baseURL: BASE_URL || '',
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
    providers,
    public: {
      defaultModel,
      providers: providerValues.map((provider) => {
        return provider.id
      }),
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
    '@nuxtjs/mdc',
    'nuxt-svgo',
    '@vueuse/nuxt',
  ],
  eslint: {
    checker: true,
  },
  svgo: {
    autoImportPath: '~/assets/icons/logos',
    defaultImport: 'component',
  },
  fonts: {
    defaults: {
      weights: [400, 700],
      styles: ['normal'],
      subsets: [
        'cyrillic-ext',
        'cyrillic',
        'latin-ext',
        'latin',
      ],
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
    optimizeDeps: {
      include: ['debug'],
    },
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
  mdc: {
    highlight: {
      shikiEngine: 'javascript',
    },
  },
})
