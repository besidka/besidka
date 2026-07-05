import { fileURLToPath } from 'node:url'
import { defineVitestConfig } from '@nuxt/test-utils/config'

// https://nuxt.com/docs/getting-started/testing
export default defineVitestConfig({
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
    globals: true,
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    include: [
      'tests/unit/**/*.spec.ts',
      'tests/integration/**/*.spec.ts',
    ],
    // Configure git integration for --changed flag
    forceRerunTriggers: [
      '**/vitest.config.mts',
      '**/nuxt.config.ts',
      '**/package.json',
    ],
    exclude: [
      'tests/e2e/**/*',
      '**/node_modules/**',
      '**/dist/**',
      '**/.nuxt/**',
    ],
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
