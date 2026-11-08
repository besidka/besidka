import type { EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import featuresPlugin from '../../../app/plugins/10.features'
import { useAuth } from '../../../app/composables/auth'
import { useFeatures } from '../../../app/composables/features'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

mockNuxtImport('$fetch', () => fetchMock)

const signedInPayload = {
  features: {
    artifacts: { enabled: true, active: true, variant: null },
  },
  isAdmin: true,
}

const anonymousPayload = {
  features: {
    artifacts: { enabled: false, active: false, variant: null },
  },
  isAdmin: false,
}

let scope: EffectScope | null = null

function getPluginSetup() {
  const setup = featuresPlugin as unknown as (
    nuxtApp: Record<string, unknown>,
  ) => Promise<unknown>

  return (nuxtApp: Record<string, unknown>) => {
    scope = effectScope()

    return scope.run(() => setup(nuxtApp))
  }
}

function createNuxtApp() {
  const hooks = new Map<string, () => Promise<void> | void>()

  return {
    hooks,
    nuxtApp: {
      payload: {},
      hook: vi.fn((name: string, callback: () => Promise<void> | void) => {
        hooks.set(name, callback)
      }),
    },
  }
}

function featureFetchCount() {
  return fetchMock.mock.calls.filter(([url]) => {
    return url === '/api/v1/features'
  }).length
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('features plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useFeatures().clearFeatures()
    useAuth().user.value = null
  })

  afterEach(() => {
    scope?.stop()
    scope = null
  })

  it('refreshes once on mount when no SSR state exists', async () => {
    fetchMock.mockResolvedValue(anonymousPayload)

    const { hooks, nuxtApp } = createNuxtApp()

    await getPluginSetup()(nuxtApp)
    await hooks.get('app:mounted')?.()

    expect(featureFetchCount()).toBeGreaterThan(0)
    expect(useFeatures().features.value).toEqual(anonymousPayload)
  })

  it('does not refetch on mount when SSR filled the state', async () => {
    useFeatures().features.value = signedInPayload

    const { hooks, nuxtApp } = createNuxtApp()

    await getPluginSetup()(nuxtApp)

    expect(hooks.has('app:mounted')).toBe(false)
    expect(featureFetchCount()).toBe(0)
  })

  it('refreshes when the user signs in or switches accounts', async () => {
    useFeatures().features.value = anonymousPayload
    fetchMock.mockResolvedValue(signedInPayload)

    const { nuxtApp } = createNuxtApp()

    await getPluginSetup()(nuxtApp)

    useAuth().user.value = { id: 'user-1' } as never
    await nextTick()
    await flushPromises()

    const afterSignIn = featureFetchCount()

    expect(afterSignIn).toBeGreaterThan(0)
    expect(useFeatures().features.value).toEqual(signedInPayload)

    useAuth().user.value = { id: 'user-2' } as never
    await nextTick()
    await flushPromises()

    expect(featureFetchCount()).toBeGreaterThan(afterSignIn)
  })

  it('clears and reloads anonymous defaults on sign-out', async () => {
    useAuth().user.value = { id: 'user-1' } as never
    useFeatures().features.value = signedInPayload
    fetchMock.mockResolvedValue(anonymousPayload)

    const { nuxtApp } = createNuxtApp()

    await getPluginSetup()(nuxtApp)

    useAuth().user.value = null
    await nextTick()
    await flushPromises()

    expect(featureFetchCount()).toBeGreaterThan(0)
    expect(useFeatures().features.value).toEqual(anonymousPayload)
  })
})
