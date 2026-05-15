import type { RouterConfig } from '@nuxt/schema'
import { createMemoryHistory } from 'vue-router'

export default {
  history: (base) => {
    if (import.meta.test) {
      return createMemoryHistory(base)
    }

    return null
  },
} satisfies RouterConfig
