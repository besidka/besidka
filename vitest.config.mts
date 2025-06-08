import { fileURLToPath } from 'node:url'
import { defineVitestConfig } from '@nuxt/test-utils/config'

// https://nuxt.com/docs/getting-started/testing
export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    coverage: {
      reportsDirectory: fileURLToPath(new URL('./coverage', import.meta.url)),
    },
  },
})
