import { fileURLToPath } from 'node:url'
import { defineVitestConfig } from '@nuxt/test-utils/config'

// https://nuxt.com/docs/getting-started/testing
export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    globals: true,
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    include: [
      'tests/unit/**/*.spec.ts',
      'tests/integration/**/*.spec.ts',
    ],
    // Enable test change detection for better --changed support
    watch: true,
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
  },
})
