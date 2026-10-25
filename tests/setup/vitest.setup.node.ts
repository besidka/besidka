import { vi } from 'vitest'

declare module 'vitest' {
  interface ProvidedContext {
    nuxtRuntimeConfig: Record<string, unknown>
  }
}

vi.mock('#app/nuxt', async (importOriginal) => {
  const { inject } = await import('vitest')
  const runtimeConfig = structuredClone(inject('nuxtRuntimeConfig'))

  return {
    ...await importOriginal<Record<string, unknown>>(),
    useRuntimeConfig: () => runtimeConfig,
  }
})
