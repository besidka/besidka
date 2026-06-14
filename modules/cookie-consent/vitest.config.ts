import { fileURLToPath } from 'node:url'
import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    globals: true,
    environmentOptions: {
      nuxt: {
        rootDir: fileURLToPath(
          new URL('./test/fixtures/basic', import.meta.url),
        ),
      },
    },
    include: ['test/**/*.spec.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.nuxt/**',
    ],
    mockReset: true,
    onConsoleLog: (log) => {
      return !log.startsWith('<Suspense>')
    },
  },
})
