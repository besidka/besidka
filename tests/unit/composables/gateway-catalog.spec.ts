import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { isProxy, nextTick, shallowRef } from 'vue'
import type { GatewayModel } from '#shared/types/gateways.d'
import {
  useGatewayCatalog,
  useGatewayCatalogCache,
} from '../../../app/composables/gateway-catalog'
import {
  installMockNuxtState,
  resetMockNuxtState,
} from '../../setup/helpers/nuxt-state'

const mocks = vi.hoisted(() => ({
  useLazyFetch: vi.fn(),
}))

mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)

const gatewayModel: GatewayModel = {
  id: 'openai/gpt-5.4',
  name: 'GPT-5.4',
  toolCall: true,
}

function mockLazyFetch() {
  const data = shallowRef<{
    gateway: 'vercel'
    models: GatewayModel[]
  } | null>(null)

  mocks.useLazyFetch.mockReturnValue({
    data,
    pending: shallowRef(false),
    error: shallowRef(null),
    refresh: vi.fn(),
  })

  return data
}

describe('useGatewayCatalog', () => {
  beforeEach(() => {
    resetMockNuxtState()
    installMockNuxtState()
    vi.clearAllMocks()
  })

  afterEach(() => {
    resetMockNuxtState()
  })

  it('caches the fetched catalog with markRaw so it never turns reactive', async () => {
    const data = mockLazyFetch()

    useGatewayCatalog('vercel')
    data.value = { gateway: 'vercel', models: [gatewayModel] }
    await nextTick()

    const cached = useGatewayCatalogCache().value.vercel

    expect(cached).toEqual([gatewayModel])
    expect(isProxy(cached)).toBe(false)
  })

  it('re-runs a computed reading the cache after the models array is reassigned', async () => {
    const data = mockLazyFetch()
    const { models } = useGatewayCatalog('vercel')

    expect(models.value).toEqual([])

    data.value = { gateway: 'vercel', models: [gatewayModel] }
    await nextTick()

    expect(models.value).toEqual([gatewayModel])

    const secondModel: GatewayModel = {
      id: 'openai/gpt-5.4-mini',
      name: 'GPT-5.4 mini',
      toolCall: false,
    }

    data.value = { gateway: 'vercel', models: [secondModel] }
    await nextTick()

    expect(models.value).toEqual([secondModel])
    expect(useGatewayCatalogCache().value.vercel).toEqual([secondModel])
  })
})
