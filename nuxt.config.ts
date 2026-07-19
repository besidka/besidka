import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import tailwindcss from '@tailwindcss/vite'
import { providers, defaultModel } from './providers'

const enableFonts = process.env.CI !== 'true'

// Stable per-build identifier, shared by Nuxt's app manifest
// (runtimeConfig.app.buildId) and the '/' SWR cache key. In CI this is the
// commit SHA; locally it is a fresh UUID per build. Binding the cache key to
// it guarantees every deploy misses the cached home-page render and re-renders
// with the live buildId. Otherwise a stale cross-deploy render inlines a
// buildId whose /_nuxt/builds/meta/<id>.json no longer exists, which 404s and
// breaks Nuxt Studio's editor (its activation awaits getAppManifest() before
// mounting the "Edit this page" UI).
const buildId = process.env.NUXT_BUILD_ID
  || process.env.GITHUB_SHA
  || randomUUID()

const modules = [
  '@nuxt/content',
  'nuxt-studio',
  '@nuxt/eslint',
  '@nuxt/icon',
  '@nuxt/image',
  '@nuxtjs/color-mode',
  '@nuxtjs/device',
  '@nuxtjs/mdc',
  '@nuxtjs/robots',
  '@nuxtjs/sitemap',
  'nuxt-svgo',
  '@vueuse/nuxt',
  '@vite-pwa/nuxt',
  'evlog/nuxt',
  '@besidka/nuxt-cookie-consent',
]

if (enableFonts) {
  modules.splice(1, 0, '@nuxt/fonts')
}

export default defineNuxtConfig({
  compatibilityDate: '2026-01-28',
  buildId,
  devtools: { enabled: true },
  features: {
    // devLogs: true,
  },
  nitro: {
    preset: 'cloudflare_module',
    experimental: {
      asyncContext: true,
    },
    cloudflare: {
      deployConfig: false,
    },
    storage: {
      cache: {
        driver: 'cloudflare-kv-binding',
        binding: 'KV',
      },
    },
    devStorage: {
      cache: {
        driver: 'fs',
        base: '.nitro/cache',
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
      drizzleDebug: false,
    },
    pwa: {
      devOptions: {
        enabled: false,
        suppressWarnings: true,
        navigateFallback: '/',
        type: 'module',
      },
    },
    studio: {
      /**
       * Uncomment to debug Nuxt Studio GitHub OAuth
       * Make sure you setup ENV vars in .dev.vars(.production|.preview)
       * and GitHub OAuth app with correct callback URL
       * @docs https://nuxt.studio/setup#dev-mode
       * @docs https://nuxt.studio/auth-providers#github
       */
      // dev: false,
    },
  },
  $production: {
    routeRules: {
      // The landing page is runtime SSR on the cloudflare_module preset: each
      // request queries CONTENT_DB via Nuxt Content. SWR caches the rendered
      // response in the KV-backed Nitro cache for 1 hour, then revalidates in
      // the background — so CONTENT_DB is queried at most once per hour per
      // edge datacenter rather than on every hit.
      //
      // `cache.name` is pinned to the per-build `buildId` so each deploy uses a
      // fresh cache key: a previous build's cached HTML (which inlines that
      // build's now-deleted app-manifest id) can never be served after a
      // redeploy. This scopes the build-busting to '/' only — the stats and
      // github-stars caches keep their own keys and still survive deploys.
      '/': { cache: { swr: true, maxAge: 3600, name: buildId } },
    },
  },
  runtimeConfig: {
    encryptionHashids: '',
    encryptionKey: '',
    emailNoopEnabled: false,
    emailSenderNoreply: '',
    emailSenderPersonalized: '',
    betterAuthSecret: '',
    googleClientId: '',
    googleClientSecret: '',
    githubClientId: '',
    githubClientSecret: '',
    filesHardMaxStorageBytes: 1 * 1024 * 1024 * 1024, // 1GB
    filesGlobalTransformLimitMonthly: 1000,
    enableAssistantFilePersistence: false,
    filesRetentionCleanupEnabled: false,
    filesRetentionCleanupBatchSize: 100,
    filesRetentionCleanupMaxRuntimeMs: 20000,
    filesMaintenanceToken: '',
    researchSweepEnabled: false,
    researchSweepBatchSize: 20,
    researchSweepMaxRuntimeMs: 20000,
    researchMockEnabled: false,
    axiomDataset: '',
    axiomToken: '',
    axiomAuditDataset: '',
    axiomAuditToken: '',
    axiomConsentDataset: '',
    axiomConsentToken: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    public: {
      baseUrl: '',
      defaultModel,
      // @ts-expect-error
      providers,
      redirectUserTo: '/chats/new',
      redirectGuestTo: '/signin',
      allowedFileFormats: [
        'image/png',
        'image/jpeg',
        'image/webp',
        'application/pdf',
        'text/plain',
      ],
      maxFilesPerMessage: 10,
      maxMessageFilesBytes: 1000 * 1024 * 1024, // 1GB
      vapidPublicKey: '',
    },
  },
  site: {
    // Canonical host is the www subdomain: a Cloudflare redirect rule sends
    // the apex (besidka.com) to www.besidka.com, so robots/sitemap/canonical
    // URLs must use www to match the post-redirect host. Override at runtime
    // with NUXT_PUBLIC_BASE_URL (set it to https://www.besidka.com in prod).
    url: process.env.NUXT_PUBLIC_BASE_URL || 'https://www.besidka.com',
    name: 'Besidka',
  },
  robots: {
    disallow: [
      '/api/',
      '/chats/',
      '/files/',
      '/profile/',
      '/signin',
      '/signup',
      '/new-password',
      '/reset-password',
      '/_studio',
      '/__nuxt_studio',
      '/__nuxt_content/',
    ],
  },
  sitemap: {
    exclude: [
      '/api/**',
      '/chats/**',
      '/files/**',
      '/profile/**',
      '/signin',
      '/signup',
      '/new-password',
      '/reset-password',
      '/_studio',
      '/__nuxt_studio',
      '/__nuxt_content/**',
    ],
  },
  colorMode: {
    dataValue: 'theme',
  },
  modules,
  evlog: {
    redact: true,
    sampling: {
      keep: [
        { status: 400 },
        { duration: 1000 },
      ],
    },
    transport: {
      enabled: true,
      endpoint: '/api/_evlog/ingest',
    },
  },
  eslint: {
    checker: process.env.CI !== 'true'
      ? {
        eslintPath: 'eslint',
      }
      : false,
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
  ...(enableFonts
    ? {
      fonts: {
        defaults: {
          weights: [400, 700, 900],
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
    }
    : {}),
  icon: {
    serverBundle: {
      remote: 'jsdelivr',
    },
    clientBundle: {
      icons: ['lucide:git-branch-plus'],
    },
  },
  future: {
    compatibilityVersion: 5,
  },
  typescript: {
    typeCheck: process.env.CI !== 'true',
  },
  vite: {
    optimizeDeps: {
      include: [
        'better-auth/vue',
        'better-auth/client/plugins',
        'ai',
        '@ai-sdk/vue',
        'ulid',
        'shiki-stream/vue',
        'shiki/bundle/web',
        'shiki/engine/javascript',
        'sanitize-html',
      ],
      // mediabunny spawns a Web Worker for UrlSource range reads; Vite's dep
      // pre-bundler breaks the worker's `new URL(..., import.meta.url)`
      // resolution, so it must be served unbundled.
      exclude: ['mediabunny'],
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
    // https://github.com/nuxt/nuxt/issues/34142#issuecomment-3791192527
    nitroAutoImports: true,
    watcher: 'builder',
  },
  hooks: {
    // App-level cookie texts must merge through the same lazy locale-file
    // pipeline as the module's own messages — config-file messages get
    // replaced when registered locale files load.
    'i18n:registerModule': (register) => {
      register({
        langDir: fileURLToPath(new URL('./i18n/locales', import.meta.url)),
        locales: [
          { code: 'en', file: 'cookie-consent.en.ts' },
          { code: 'uk', file: 'cookie-consent.uk.ts' },
        ],
      })
    },
    // @nuxt/content marks /__nuxt_content/**/sql_dump.txt routes as
    // prerender:true so the SQL dumps are embedded in the static output.
    // The Cloudflare Workers preset (cloudflare_module) cannot prerender
    // server-side routes that import cloudflare: bindings. Remove those
    // prerender rules after all modules have set them so the build succeeds.
    'nitro:config': (nitroConfig) => {
      if (!nitroConfig.routeRules) {
        return
      }

      for (const route of Object.keys(nitroConfig.routeRules)) {
        if (
          route.startsWith('/__nuxt_content/')
          || route === '/__preview.json'
        ) {
          nitroConfig.routeRules[route] = {
            ...nitroConfig.routeRules[route],
            prerender: false,
          }
        }
      }
    },
  },
  cookieConsent: {
    categories: [
      {
        id: 'necessary',
        required: true,
        entries: [
          {
            id: 'consent',
            name: 'cookies_consent',
            type: 'cookie',
          },
          {
            id: 'session-token',
            name: '__Secure-better-auth.session_token',
            type: 'cookie',
          },
          {
            id: 'chat-input-backup',
            name: 'chat_input_backup',
            type: 'localStorage',
          },
        ],
      },
      {
        id: 'preferences',
        entries: [
          {
            id: 'last-login-method',
            name: 'better_auth.last_login_method',
            type: 'cookie',
          },
          {
            id: 'color-mode',
            name: 'nuxt-color-mode',
            type: 'localStorage',
          },
          {
            id: 'color-mode-cookie',
            name: 'nuxt-color-mode',
            type: 'cookie',
          },
          {
            id: 'file-manager-view-mode',
            name: 'file-manager-view-mode',
            type: 'localStorage',
          },
          {
            id: 'reasoning-expanded',
            name: 'settings_reasoning_expanded',
            type: 'localStorage',
          },
          {
            id: 'reasoning-auto-hide',
            name: 'settings_reasoning_auto_hide',
            type: 'localStorage',
          },
          {
            id: 'reasoning-level',
            name: 'settings_reasoning_level',
            type: 'localStorage',
          },
          {
            id: 'chat-input',
            name: 'chat_input',
            type: 'localStorage',
          },
          {
            id: 'model',
            name: 'model',
            type: 'localStorage',
          },
          {
            id: 'plyr',
            name: 'plyr',
            type: 'localStorage',
          },
          {
            id: 'sidebar-pinned',
            name: 'settings_sidebar_pinned',
            type: 'localStorage',
          },
        ],
      },
      // {
      //   id: 'analytics',
      //   entries: [],
      // },
      // {
      //   id: 'marketing',
      //   entries: [],
      // },
    ],
  },
  mdc: {
    remarkPlugins: {
      'remark-breaks': {},
    },
    highlight: {
      shikiEngine: 'javascript',
    },
  },
  content: {
    // Nuxt Content forces D1 on the cloudflare_module preset (even in dev,
    // where wrangler provides a local D1 emulation), so we always point it
    // at the dedicated CONTENT_DB binding — never the app's `DB` binding.
    // Do NOT override this to sqlite for dev: the module's cloudflare
    // preset silently switches sqlite back to D1 with the default `DB`
    // binding, mixing content tables into the app database.
    //
    // The client-side dump endpoint
    // (/__nuxt_content/<collection>/sql_dump.txt) is broken in dev by the
    // wrangler ASSETS proxy binding — fixed by
    // server/plugins/content-assets-dev.ts (see its comment).
    //
    // The landing page is runtime SSR: CONTENT_DB is queried at runtime on
    // each cache miss (see routeRules '/' swr above). It is NOT prerendered.
    database: {
      type: 'd1',
      bindingName: 'CONTENT_DB',
    },
  },
  studio: {
    repository: {
      provider: 'github',
      owner: 'besidka',
      repo: 'besidka',
      branch: 'main',
      private: false,
    },
    editor: {
      iconLibraries: ['lucide', 'streamline-logos'],
    },
    git: {
      commit: {
        messagePrefix: 'content:',
      },
    },
  },
  // https://stackblitz.com/edit/vite-pwa-nuxt-42xnmfqg?file=playground%2Fnuxt.config.ts
  pwa: {
    registerWebManifestInRouteRules: true,
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      globIgnores: ['_studio-app/**'],
      navigateFallback: null,
      // Workbox's generateSW strategy builds the whole service worker from
      // its own config and has no hook for custom push/notificationclick
      // listeners — importScripts is the only way to add them without
      // switching to injectManifest (which would mean owning the entire SW
      // source, caching strategy included). sw-push.js lives in public/ and
      // is concatenated into the generated worker as-is. The buildId query
      // busts HTTP caching of the imported script: registration
      // updateViaCache defaults to 'imports', so without it a new worker
      // shell could keep executing a stale cached sw-push.js after deploy.
      importScripts: [`/sw-push.js?v=${buildId}`],
    },
    client: {
      installPrompt: true,
      periodicSyncForUpdates: 60 * 5,
    },
  },
})
