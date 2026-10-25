import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { defineVitestConfig } from '@nuxt/test-utils/config'
import {
  NODE_PROJECT_NAME,
  NUXT_PROJECT_NAME,
  nodeProjectExclude,
  nodeProjectInclude,
  nuxtProjectInclude,
} from './tests/setup/vitest.projects.ts'

const VAPOR_BLOCK_ATTRIBUTE = /(<(?:script|template)\b[^>]*?)\svapor(?=[\s>])/g

const COMMON_SETUP_FILE = './tests/setup/vitest.setup.common.ts'

const DOM_SETUP_FILE = './tests/setup/vitest.setup.dom.ts'

const NODE_SETUP_FILE = './tests/setup/vitest.setup.node.ts'

const BASE_EXCLUDE = [
  'tests/e2e/**/*',
  '**/node_modules/**',
  '**/dist/**',
  '**/.nuxt/**',
]

const stripVaporAttributePlugin = {
  name: 'besidka:strip-vapor-attribute',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.endsWith('.vue')) {
      return null
    }

    const stripped = code.replace(VAPOR_BLOCK_ATTRIBUTE, '$1')

    return stripped === code ? null : { code: stripped, map: null }
  },
}

// https://nuxt.com/docs/getting-started/testing
const resolveNuxtConfig = defineVitestConfig({
  plugins: [stripVaporAttributePlugin],
  // Suite-wide: modules importing `cloudflare:workers` resolve to the stub
  // (env = {}). That specifier only exists in workerd/Nitro, not Vite, so
  // tests must inject bindings explicitly rather than read from env.
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(
        new URL('./tests/setup/mocks/cloudflare-workers.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'nuxt',
    environmentOptions: {
      nuxt: {
        overrides: {
          vue: {
            vapor: false,
          },
        },
      },
    },
    globals: true,
    pool: 'threads',
    setupFiles: [COMMON_SETUP_FILE, DOM_SETUP_FILE],
    include: nuxtProjectInclude,
    // Configure git integration for --changed flag
    forceRerunTriggers: [
      '**/vitest.config.mts',
      '**/nuxt.config.ts',
      '**/package.json',
    ],
    exclude: BASE_EXCLUDE,
    mockReset: true,
    coverage: {
      reportsDirectory: fileURLToPath(new URL('./coverage', import.meta.url)),
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'app/composables/**/*.ts',
        'app/components/**/*.vue',
        'app/utils/**/*.ts',
        'server/api/**/*.ts',
        'server/utils/**/*.ts',
      ],
      exclude: [
        '**/node_modules/**',
        '**/tests/**',
        '**/*.config.*',
        '**/.nuxt/**',
        '**/dist/**',
        '**/*.d.ts',
        '**/types/**',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
    onConsoleLog: (log) => {
      return !log.startsWith('<Suspense>')
    },
  },
})

export default defineConfig(async (configEnv) => {
  const { test: nuxtTestConfig = {}, ...viteConfig } = await resolveNuxtConfig(
    configEnv,
  )
  const {
    coverage,
    forceRerunTriggers,
    onConsoleLog,
    ...nuxtProjectTestConfig
  } = nuxtTestConfig
  const nodeProjectTestConfig = {
    ...nuxtProjectTestConfig,
    name: NODE_PROJECT_NAME,
    environment: 'node' as const,
    setupFiles: [COMMON_SETUP_FILE, NODE_SETUP_FILE],
    provide: {
      nuxtRuntimeConfig: nuxtTestConfig.environmentOptions
        ?.nuxtRuntimeConfig as Record<string, unknown>,
    },
    include: nodeProjectInclude,
    exclude: [...BASE_EXCLUDE, ...nodeProjectExclude],
  }

  delete nodeProjectTestConfig.environmentOptions

  return {
    ...viteConfig,
    test: {
      coverage,
      forceRerunTriggers,
      onConsoleLog,
      projects: [
        {
          ...viteConfig,
          test: nodeProjectTestConfig,
        },
        {
          ...viteConfig,
          test: {
            ...nuxtProjectTestConfig,
            name: NUXT_PROJECT_NAME,
          },
        },
      ],
    },
  }
})
