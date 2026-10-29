import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { defineNuxtModule } from '@nuxt/kit'
import tailwindcss from '@tailwindcss/vite'
import { providers, defaultModel } from './providers/index.ts'
import rehypeStripDirectiveProps from './shared/utils/mdc/rehype-strip-directive-props.ts'
import {
  agentDiscoveryRoutes,
  contentPathRedirects,
} from './config/agent-discovery-routes.ts'
import {
  MCP_DISABLED_TOOLKIT_ROUTES,
  MCP_SERVER_CARD_PATH,
  MCP_SERVER_DESCRIPTION,
  MCP_SERVER_ROUTE,
  MCP_SERVER_TITLE,
  MCP_SERVER_VERSION,
} from './config/mcp-server.ts'
import { assertSecureSiteUrl, resolveSiteUrl } from './config/site-url.ts'

const siteUrl = resolveSiteUrl(process.env)

const contentSignal = 'search=yes, ai-input=yes, ai-train=no'

const keyGuidesLlmsSection = {
  title: 'API key guides',
  description: 'Step-by-step guides for getting an API key from each provider.',
  contentCollection: 'keyGuides',
}

const stripDirectivePropsPlugin = {
  src: '~~/shared/utils/mdc/rehype-strip-directive-props',
  instance: rehypeStripDirectiveProps,
}

// nuxt-email-renderer only inlines `vue-i18n` into the Nitro bundle when it
// detects the literal string '@nuxtjs/i18n' in `nuxt.options.modules` (see
// its `hasI18n` check). `@nuxtjs/i18n` is active here, but only as a
// `moduleDependency` of `@besidka/nuxt-cookie-consent`, never as a literal
// entry in this file's `modules` array, so that check misses it and
// nuxt-email-renderer instead marks `vue-i18n` as a Rollup `external`. On
// Cloudflare Workers there is no runtime package resolution, so the bare
// `await import('vue-i18n')` inside its email-rendering path throws on every
// send. This module runs after `nuxt-email-renderer` (module setup order
// follows the `modules` array) and corrects that decision.
//
// This only fixes Nitro's build-time externalization decision for the
// `vue-i18n` import itself. It does NOT fix nuxt-email-renderer's separate
// locale-message-loading hook, which is gated by the same `hasI18n` check
// and is therefore also inert here. Today that's harmless because neither
// `ActionEmail.vue` nor `NoticeEmail.vue` calls `useI18n()`/`$t()`. If a
// future email template adds real i18n calls, it will render with empty
// message catalogs rather than throw — a latent gap, not a bug today.
const forceInlineVueI18nForEmailRenderer = defineNuxtModule({
  meta: { name: 'force-inline-vue-i18n-for-email-renderer' },
  setup(_options, nuxt) {
    nuxt.hook('nitro:config', (nitroConfig) => {
      if (Array.isArray(nitroConfig.rollupConfig?.external)) {
        nitroConfig.rollupConfig.external = nitroConfig.rollupConfig.external
          .filter(external => external !== 'vue-i18n')
      }

      nitroConfig.externals ||= {}

      const inline = Array.isArray(nitroConfig.externals.inline)
        ? nitroConfig.externals.inline
        : []

      if (!inline.includes('vue-i18n')) {
        inline.push('vue-i18n')
      }

      nitroConfig.externals.inline = inline
    })
  },
})

const forceStatelessMcpTransport = defineNuxtModule({
  meta: { name: 'force-stateless-mcp-transport' },
  setup(_options, nuxt) {
    const nodeProviderPath = fileURLToPath(
      new URL(
        'runtime/server/mcp/providers/node.js',
        import.meta.resolve('@nuxtjs/mcp-toolkit'),
      ),
    )

    nuxt.options.nitro.virtual ||= {}
    nuxt.options.nitro.virtual['#nuxt-mcp-toolkit/transport.mjs'] = () => {
      return `export { default } from '${nodeProviderPath}'`
    }
  },
})

const guardMdcSlotTransformForVapor = defineNuxtModule({
  meta: { name: 'guard-mdc-slot-transform-for-vapor' },
  setup(_options, nuxt) {
    nuxt.hook('vite:extendConfig', (viteConfig) => {
      const compilerOptions = viteConfig.vue?.template?.compilerOptions

      if (!compilerOptions?.nodeTransforms) {
        return
      }

      compilerOptions.nodeTransforms = compilerOptions.nodeTransforms.map(
        (nodeTransform) => {
          if (nodeTransform.name !== 'viteMDCSlot') {
            return nodeTransform
          }

          return function viteMDCSlot(node, context) {
            if (!context.nodeTransforms) {
              return
            }

            return nodeTransform(node, context)
          }
        },
      )
    })
  },
})

const externalizeComponentsImportInDependencyScan = {
  name: 'externalize-components-import-in-dependency-scan',
  resolveId(id: string) {
    if (id !== '#components') {
      return
    }

    return { id, external: true }
  },
}

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

const iconCollections = ['lucide', 'simple-icons', 'bxl', 'streamline-logos']

const videoJsElements = new Set([
  'video-player',
  'media-container',
  'media-controls',
  'media-controls-content',
  'media-controls-group',
  'media-tooltip-group',
  'media-tooltip',
  'media-tooltip-label',
  'media-play-button',
  'media-mute-button',
  'media-volume-slider',
  'media-time',
  'media-time-slider',
  'media-time-slider-chapters',
  'media-time-slider-chapter-title',
  'media-slider-track',
  'media-slider-buffer',
  'media-slider-fill',
  'media-slider-thumb',
  'media-slider-preview',
  'media-slider-thumbnail',
  'media-slider-value',
  'media-captions-button',
  'media-captions-radio-group',
  'media-menu',
  'media-menu-content',
  'media-menu-item',
  'media-menu-radio-group',
  'media-menu-radio-item',
  'media-menu-item-indicator',
  'media-pip-button',
  'media-airplay-button',
  'media-fullscreen-button',
  'media-hotkey',
  'media-gesture',
  'media-icon',
])

const modules = [
  '@nuxt/content',
  '@nuxt/fonts',
  'nuxt-studio',
  '@nuxt/eslint',
  '@nuxt/icon',
  '@nuxt/image',
  '@nuxt/scripts',
  '@nuxtjs/color-mode',
  '@nuxtjs/device',
  '@nuxtjs/mdc',
  guardMdcSlotTransformForVapor,
  '@nuxtjs/mcp-toolkit',
  forceStatelessMcpTransport,
  '@nuxtjs/robots',
  '@nuxtjs/sitemap',
  'nuxt-llms',
  'nuxt-agent-discovery',
  'nuxt-svgo',
  '@vueuse/nuxt',
  '@vite-pwa/nuxt',
  'evlog/nuxt',
  '@besidka/nuxt-cookie-consent',
  'nuxt-email-renderer',
  forceInlineVueI18nForEmailRenderer,
]

export default defineNuxtConfig({
  compatibilityDate: '2026-01-28',
  buildId,
  devtools: { enabled: true },
  features: {
    // devLogs: true,
  },
  routeRules: {
    '/privacy': { redirect: { to: '/privacy-policy', statusCode: 301 } },
    '/terms': { redirect: { to: '/terms-of-use', statusCode: 301 } },
    ...contentPathRedirects,
    ...Object.fromEntries(
      MCP_DISABLED_TOOLKIT_ROUTES.map((route) => {
        return [route, { redirect: { to: '/', statusCode: 404 } }]
      }),
    ),
  },
  nitro: {
    preset: 'cloudflare_module',
    moduleSideEffects: [
      'reflect-metadata/',
    ],
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
      // request queries CONTENT_DB via Nuxt Content. Nitro caches the rendered
      // response in the KV-backed Nitro cache with a 1 hour KV TTL — so
      // CONTENT_DB is queried at most once per hour per edge datacenter
      // rather than on every hit. `swr` is off because Nitro writes swr
      // entries to KV with no TTL. The cache key ignores the query string
      // (`server/plugins/cache-key-without-query.ts`), so attacker-chosen
      // `?x=<random>` URLs share one entry.
      //
      // `cache.name` is pinned to the per-build `buildId` so each deploy uses a
      // fresh cache key: a previous build's cached HTML (which inlines that
      // build's now-deleted app-manifest id) can never be served after a
      // redeploy. This scopes the build-busting to '/' only — the stats and
      // github-stars caches keep their own keys and still survive deploys.
      '/': { cache: { swr: false, maxAge: 3600, name: buildId } },
      '/raw/**': { cache: { swr: false, maxAge: 3600, name: buildId } },
    },
  },
  runtimeConfig: {
    encryptionHashids: '',
    encryptionKey: '',
    emailNoopEnabled: false,
    emailSenderNoreply: '',
    emailSenderPersonalized: '',
    betterAuthSecret: '',
    authAdditionalAllowedHosts: '',
    googleClientId: '',
    googleClientSecret: '',
    githubClientId: '',
    githubClientSecret: '',
    turnstileSecretKey: '',
    turnstileEnforced: false,
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
    memoryExtractionSweepEnabled: false,
    memoryExtractionSweepBatchSize: 20,
    memoryExtractionSweepMaxRuntimeMs: 120000,
    memoryBackfillSweepEnabled: false,
    memoryBackfillSweepMaxRuntimeMs: 45000,
    researchMockEnabled: false,
    messageSearchSweepEnabled: false,
    messageSearchSweepBatchSize: 200,
    messageSearchSweepMaxRuntimeMs: 20000,
    knowledgeSweepEnabled: false,
    knowledgeSweepBatchSize: 1000,
    knowledgeSweepMaxRuntimeMs: 20000,
    axiomDataset: '',
    axiomToken: '',
    axiomAuditDataset: '',
    axiomAuditToken: '',
    axiomConsentDataset: '',
    axiomConsentToken: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    // Public by design (served at /indexnow-key.txt); see docs/seo.md.
    indexnowKey: '',
    public: {
      baseUrl: '',
      privacyEmail: '',
      authorGithubProfile: '',
      defaultModel,
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
      turnstileSiteKey: '',
      cloudflareWebAnalyticsToken: '',
      webmcpOriginTrialToken: '',
      e2eTestHooksEnabled: false,
      googleSearchCostPerThousandQueriesUsd: '',
      googleSearchCostPerThousandGroundedPromptsUsd: '',
      anthropicWebSearchCostPerThousandSearchesUsd: '',
      openaiWebSearchCostPerThousandCallsUsd: '',
      braveSearchCostPerThousandRequestsUsd: '',
      exaLiteSearchCostPerThousandRequestsUsd: '',
      exaSearchCostPerThousandRequestsUsd: '',
      exaDeepSearchCostPerThousandRequestsUsd: '',
      deepseekSearchCostPerThousandRequestsUsd: '',
    },
  },
  site: {
    // Canonical host is the apex: a Cloudflare redirect rule sends
    // www.besidka.com to the apex (besidka.com), so robots/sitemap/canonical
    // URLs must use the apex to match the post-redirect host. Override at
    // runtime with NUXT_PUBLIC_BASE_URL (set it to https://besidka.com in
    // prod).
    url: siteUrl,
    name: 'Besidka',
  },
  // /signin, /signup and /reset-password are crawler-reachable and rely on a
  // useSeoMeta `noindex` instead — a Disallow-ed URL is never fetched, so its
  // noindex is never read. /new-password and /2fa stay disallowed: nothing
  // crawlable links to either — /2fa is only reached via a client-side
  // redirect after a password sign-in that requires a second factor. See
  // docs/seo.md.
  robots: {
    groups: [
      {
        userAgent: ['*'],
        contentSignal,
      },
    ],
    disallow: [
      '/api/',
      '/chats/',
      '/files/',
      '/profile/',
      '/new-password',
      '/2fa',
      '/_studio',
      '/__nuxt_studio',
      '/__nuxt_content/',
      '/mcp',
    ],
  },
  llms: {
    domain: siteUrl,
    title: 'Besidka',
    description: 'Open-source bring-your-own-key AI chat app that runs on Cloudflare Workers. Users bring their own API keys for AI providers such as Anthropic, OpenAI and Google, and pay the providers directly.',
    prerender: false,
    notes: [
      'This llms.txt covers only the Besidka app and landing site.',
      'Product documentation and a blog are planned as separate apps at /docs and /blog, each with its own llms.txt. They are not published yet.',
      'Besidka has no public application API: application endpoints require a signed-in session. The read-only MCP server at /mcp is public.',
      'Content signals in robots.txt allow search and AI input and disallow AI training.',
    ],
    sections: [
      {
        title: 'Overview',
        links: [
          {
            title: 'Besidka',
            description: 'What Besidka is, its features and answers to common questions.',
            href: `${siteUrl}/`,
          },
        ],
      },
      {
        title: 'Guides',
        links: [
          {
            title: 'BYOK: use GPT, Claude and Gemini with your own API key',
            description: 'How bring-your-own-key works, what it costs and how keys are stored.',
            href: `${siteUrl}/byok`,
          },
          {
            title: 'How memory works in Besidka',
            description: 'What Besidka remembers, and how to see, edit and delete it.',
            href: `${siteUrl}/memory`,
          },
        ],
      },
      keyGuidesLlmsSection,
      {
        title: 'Legal',
        links: [
          {
            title: 'Privacy Policy',
            href: `${siteUrl}/privacy-policy`,
          },
          {
            title: 'Terms of Use',
            href: `${siteUrl}/terms-of-use`,
          },
          {
            title: 'Cookie Policy',
            href: `${siteUrl}/cookie-policy`,
          },
        ],
      },
      {
        title: 'Agent resources',
        links: [
          {
            title: 'Agent skills index',
            description: 'Agent Skills Discovery index of the skills published by this site.',
            href: `${siteUrl}/.well-known/agent-skills/index.json`,
          },
          {
            title: 'AI catalog',
            description: 'ARD catalog of the AI resources published by this site.',
            href: `${siteUrl}/.well-known/ai-catalog.json`,
          },
          {
            title: 'MCP server card',
            description: 'Server card of the public read-only MCP server at /mcp.',
            href: `${siteUrl}${MCP_SERVER_CARD_PATH}`,
          },
        ],
      },
    ],
  },
  agentDiscovery: {
    siteUrl,
    siteName: 'Besidka',
    routes: agentDiscoveryRoutes,
    excludePrefixes: {
      extend: ['/chats', '/profile', '/files', '/shared'],
    },
    discovery: {
      link: true,
      apiCatalog: true,
      sitemapXml: true,
      links: [
        {
          href: '/.well-known/ai-catalog.json',
          rel: 'describedby',
          type: 'application/ai-catalog+json',
          title: 'AI catalog: AI resources published by this site',
        },
        {
          href: MCP_SERVER_CARD_PATH,
          rel: 'service-desc',
          type: 'application/json',
          anchor: MCP_SERVER_ROUTE,
          header: false,
        },
        {
          href: '/llms.txt',
          rel: 'service-doc',
          type: 'text/plain',
          anchor: MCP_SERVER_ROUTE,
          header: false,
        },
        {
          href: '/.well-known/agent-skills/index.json',
          rel: 'index',
          type: 'application/json',
          title: 'Agent skills index in the Agent Skills Discovery format',
        },
      ],
    },
    robots: {
      aiPolicy: false,
      contentSignal,
    },
    sitemap: {
      markdown: false,
    },
    skills: {
      dir: 'skills',
    },
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
      '/2fa',
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
  mcp: {
    name: MCP_SERVER_TITLE,
    version: MCP_SERVER_VERSION,
    description: MCP_SERVER_DESCRIPTION,
    route: MCP_SERVER_ROUTE,
    browserRedirect: '/',
    logging: false,
  },
  nuxtEmailRenderer: {
    emailsDir: 'app/emails',
    codeHighlighting: false,
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
    provider: 'npm',
  },
  icon: {
    collections: iconCollections,
    fallbackToApi: false,
    serverBundle: {
      remote: 'jsdelivr',
      collections: iconCollections,
    },
    clientBundle: {
      icons: ['lucide:git-branch-plus', 'thesvg:zhipu'],
    },
  },
  future: {
    compatibilityVersion: 5,
  },
  vue: {
    vapor: true,
    compilerOptions: {
      isCustomElement: (tag) => {
        return videoJsElements.has(tag)
      },
    },
  },
  typescript: {
    typeCheck: process.env.CI !== 'true',
  },
  vite: {
    build: {
      // Vite 8's new cssMinify default ('lightningcss') breaks this app's
      // light theme in production builds via a DaisyUI/Lightning CSS
      // selector-specificity interaction. See docs/vite-css-minify.md
      // before changing or reverting this.
      cssMinify: 'esbuild',
    },
    worker: {
      format: 'es',
    },
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
      rolldownOptions: {
        plugins: [externalizeComponentsImportInDependencyScan],
      },
    },
    plugins: [
      tailwindcss(),
    ],
  },
  css: ['~/assets/css/main.css'],
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
    asyncContext: true,
    early404: true,
    stripNeverHydratedData: true,
    strictRouteTypes: true,
    extractAsyncDataHandlers: true,
    typescriptPlugin: true,
    // https://github.com/nuxt/nuxt/issues/34142#issuecomment-3791192527
    nitroAutoImports: true,
    prefetchPreloadTags: true,
    entryImportMap: false,
  },
  hooks: {
    'ready': (nuxt) => {
      if (nuxt.options.dev || nuxt.options.test || nuxt.options._prepare) {
        return
      }

      assertSecureSiteUrl(siteUrl)
    },
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
    'nitro:build:before': (nitro) => {
      nitro.hooks.hook('prerender:routes', (routes) => {
        routes.clear()
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
    revision: 2,
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
            name: 'better-auth.session_token',
            type: 'cookie',
          },
          {
            id: 'session-data',
            name: 'better-auth.session_data',
            type: 'cookie',
          },
          {
            id: 'dont-remember',
            name: 'better-auth.dont_remember',
            type: 'cookie',
          },
          {
            id: 'oauth-state',
            name: 'better-auth.state',
            type: 'cookie',
          },
          {
            id: 'two-factor',
            name: 'better-auth.two_factor',
            type: 'cookie',
          },
          {
            id: 'trust-device',
            name: 'better-auth.trust_device',
            type: 'cookie',
          },
          {
            id: 'passkey-challenge',
            name: 'better-auth.better-auth-passkey',
            type: 'cookie',
          },
          {
            id: 'studio-session-check',
            name: 'studio-session-check',
            type: 'cookie',
          },
          {
            id: 'chat-input-backup',
            name: 'chat_input_backup',
            type: 'localStorage',
          },
          {
            id: 'push-endpoint',
            name: 'besidka:push-endpoint',
            type: 'localStorage',
          },
          {
            id: 'knowledge-folders',
            name: 'knowledge-folders:*',
            type: 'localStorage',
          },
          {
            id: 'pwa-refresher-dismissed',
            name: 'pwa:refresher-dismissed-until',
            type: 'sessionStorage',
          },
          {
            id: 'pwa-auto-refresh-applied',
            name: 'pwa:auto-refresh-applied-until',
            type: 'sessionStorage',
          },
        ],
      },
      {
        id: 'preferences',
        entries: [
          {
            id: 'last-login-method',
            // Real Better Auth cookie name (hyphenated prefix,
            // "last_used_login_method") — see the lastLoginMethod plugin's
            // default cookieName. Do not "fix" this back to
            // better_auth.last_login_method; that name matches nothing.
            name: 'better-auth.last_used_login_method',
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
            id: 'exa-search-level',
            name: 'settings_exa_search_level',
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
            id: 'video-player',
            name: 'video-player',
            type: 'localStorage',
          },
          {
            id: 'sidebar-pinned',
            name: 'settings_sidebar_pinned',
            type: 'localStorage',
          },
          {
            id: 'favorite-models',
            name: 'settings_favorite_models',
            type: 'localStorage',
          },
          {
            id: 'favorite-gateway-models',
            name: 'settings_favorite_gateway_models',
            type: 'localStorage',
          },
          {
            id: 'web-search-tool',
            name: 'settings_web_search_tool',
            type: 'localStorage',
          },
          {
            id: 'web-search-auto',
            name: 'settings_web_search_auto',
            type: 'localStorage',
          },
          {
            id: 'knowledge-cache-info-seen',
            name: 'knowledge-cache-info-seen',
            type: 'localStorage',
          },
        ],
      },
      {
        id: 'analytics',
        entries: [],
      },
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
    rehypePlugins: {
      'rehype-strip-directive-props': stripDirectivePropsPlugin,
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
    strategies: 'injectManifest',
    srcDir: 'service-worker',
    filename: 'sw.ts',
    injectManifest: {
      injectionPoint: '',
      rollupFormat: 'iife',
      buildPlugins: {
        vite: [
          {
            name: 'besidka:sw-build-id',
            config: () => {
              return { define: { __SW_BUILD_ID__: JSON.stringify(buildId) } }
            },
          },
        ],
      },
    },
    client: {
      installPrompt: true,
      periodicSyncForUpdates: 60 * 5,
    },
  },
})
