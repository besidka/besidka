import tailwindcss from '@tailwindcss/vite'
import { providers, defaultModel } from './providers'

export default defineNuxtConfig({
  compatibilityDate: '2026-01-28',
  devtools: { enabled: true },
  features: {
    // devLogs: true,
  },
  nitro: {
    preset: 'cloudflare_module',
    // minify: false,
    experimental: {
      asyncContext: true,
    },
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
      wrangler: {
        observability: {
          enabled: true,
          head_sampling_rate: 1,
        },
        placement: {
          mode: 'smart',
        },
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
      drizzleDebug: true,
    },
    pwa: {
      devOptions: {
        enabled: false,
        suppressWarnings: true,
        navigateFallback: '/',
        type: 'module',
      },
    },
  },
  runtimeConfig: {
    encryptionHashids: '',
    encryptionKey: '',
    resendApiKey: '',
    resendSenderNoreply: '',
    resendSenderPersonalized: '',
    betterAuthSecret: '',
    googleClientId: '',
    googleClientSecret: '',
    githubClientId: '',
    githubClientSecret: '',
    public: {
      baseUrl: '',
      defaultModel,
      // @ts-expect-error
      providers,
      redirectUserTo: '/chats/new',
      redirectGuestTo: '/signin',
    },
  },
  colorMode: {
    dataValue: 'theme',
  },
  modules: [
    '@nuxt/eslint',
    '@nuxt/fonts',
    '@nuxt/icon',
    '@nuxt/image',
    '@nuxtjs/color-mode',
    '@nuxtjs/device',
    '@nuxtjs/mdc',
    'nuxt-svgo',
    '@vueuse/nuxt',
    '@vite-pwa/nuxt',
  ],
  eslint: {
    checker: true,
  },
  svgo: {
    autoImportPath: '~/assets/icons',
    defaultImport: 'component',
    svgoConfig: {
      multipass: true,
      plugins: [
        'removeDimensions',
        {
          name: 'preset-default',
          params: {
            overrides: {
              cleanupIds: false,
              inlineStyles: {
                onlyMatchedOnce: false,
              },
              removeDoctype: false,
              removeViewBox: false,
              removeUnknownsAndDefaults: {
                keepDataAttrs: true,
                keepAriaAttrs: true,
                keepRoleAttr: true,
                unknownAttrs: false,
                defaultAttrs: false,
              },
            },
          },
        },
      ],
    },
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
      remote: 'jsdelivr',
    },
  },
  future: {
    compatibilityVersion: 5,
  },
  typescript: {
    typeCheck: true,
  },
  vite: {
    optimizeDeps: {
      include: ['debug'],
    },
    plugins: [
      tailwindcss(),
    ],
  },
  css: ['./assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: {
        lang: 'en',
      },
      meta: [
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
        },
        {
          name: 'description',
          content: 'Open-source AI chat application. Bring your API key and start chatting with available LLMs!',
        },
        {
          name: 'apple-mobile-web-app-title',
          content: 'Besidka',
        },
      ],
      link: [
        { rel: 'shortcut icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/png', href: '/favicon-96x96.png', sizes: '96x96' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      ],
    },
  },
  experimental: {
    componentIslands: true,
    viteEnvironmentApi: true,
    extractAsyncDataHandlers: true,
    typescriptPlugin: true,
  },
  mdc: {
    remarkPlugins: {
      'remark-breaks': {},
    },
    highlight: {
      shikiEngine: 'javascript',
    },
  },
  // https://stackblitz.com/edit/vite-pwa-nuxt-42xnmfqg?file=playground%2Fnuxt.config.ts
  pwa: {
    registerWebManifestInRouteRules: true,
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      navigateFallback: null,
    },
    client: {
      installPrompt: true,
      periodicSyncForUpdates: 60 * 5,
    },
  },
})
