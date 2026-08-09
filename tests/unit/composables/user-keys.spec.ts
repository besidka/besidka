import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { useUserKeys } from '../../../app/composables/user-keys'

interface KeySummaryRow {
  provider: string
  hasKey: boolean
}

const mocks = vi.hoisted(() => ({
  useLazyFetch: vi.fn(),
  refresh: vi.fn(),
}))

mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)

function createFetchState(
  rows: KeySummaryRow[] | null,
  options: { pending?: boolean, error?: unknown } = {},
) {
  return {
    data: shallowRef(rows ? { keys: rows } : null),
    pending: shallowRef(options.pending ?? false),
    error: shallowRef(options.error ?? null),
    refresh: mocks.refresh,
  }
}

function useSummary(
  rows: KeySummaryRow[] | null,
  options: { pending?: boolean, error?: unknown } = {},
) {
  const state = createFetchState(rows, options)

  mocks.useLazyFetch.mockReturnValue(state)

  return state
}

describe('useUserKeys', () => {
  beforeEach(() => {
    mocks.useLazyFetch.mockReset()
    mocks.refresh.mockReset()
  })

  it('shares a single keyed request across every caller', () => {
    useSummary([])

    useUserKeys()
    useUserKeys()

    const requestedKeys = mocks.useLazyFetch.mock.calls.map((call) => {
      return call.slice(0, 2)
    })

    expect(requestedKeys).toEqual([
      ['/api/v1/profiles/keys', { key: 'user-keys' }],
      ['/api/v1/profiles/keys', { key: 'user-keys' }],
    ])
  })

  it('reports presence per provider from the summary', () => {
    useSummary([
      { provider: 'google', hasKey: true },
      { provider: 'openai', hasKey: false },
    ])

    const { hasKey } = useUserKeys()

    expect(hasKey('google')).toBe(true)
    expect(hasKey('openai')).toBe(false)
  })

  it('resolves a gateway through its keys-table id, not its bare GatewayId', () => {
    useSummary([
      { provider: 'vercel-gateway', hasKey: false },
      { provider: 'openrouter', hasKey: true },
    ])

    const { hasKeyForProvider } = useUserKeys()

    expect(hasKeyForProvider('vercel')).toBe(false)
    expect(hasKeyForProvider('openrouter')).toBe(true)
  })

  it('resolves cloudflare through its keys-table id, cloudflare-gateway', () => {
    useSummary([
      { provider: 'cloudflare-gateway', hasKey: false },
    ])

    const { hasKey, hasKeyForProvider } = useUserKeys()

    expect(hasKeyForProvider('cloudflare')).toBe(false)
    expect(hasKey('cloudflare')).toBe(true)

    useSummary([
      { provider: 'cloudflare-gateway', hasKey: true },
    ])

    expect(useUserKeys().hasKeyForProvider('cloudflare')).toBe(true)
  })

  it('fails open on the bare GatewayId, which is why the mapping is required', () => {
    useSummary([{ provider: 'vercel-gateway', hasKey: false }])

    const { hasKey } = useUserKeys()

    expect(hasKey('vercel-gateway')).toBe(false)
    expect(hasKey('vercel')).toBe(true)
  })

  it('maps a direct provider onto its identically named key id', () => {
    useSummary([{ provider: 'moonshotai', hasKey: false }])

    const { hasKeyForProvider } = useUserKeys()

    expect(hasKeyForProvider('moonshotai')).toBe(false)
  })

  it('reports every provider as available while the first fetch is in flight', () => {
    useSummary(null, { pending: true })

    const { pending, hasKey, hasKeyForProvider, hasAnyKey } = useUserKeys()

    expect(pending.value).toBe(true)
    expect(hasKey('google')).toBe(true)
    expect(hasKeyForProvider('vercel')).toBe(true)
    expect(hasAnyKey.value).toBe(true)
  })

  it('reports every provider as available when the summary request failed', () => {
    useSummary(null, { error: new Error('offline') })

    const { hasKey, hasKeyForProvider, hasAnyKey } = useUserKeys()

    expect(hasKey('google')).toBe(true)
    expect(hasKeyForProvider('vercel')).toBe(true)
    expect(hasAnyKey.value).toBe(true)
  })

  it('stops reporting pending once data is loaded, so a refresh cannot re-open the gate', () => {
    const state = useSummary([{ provider: 'google', hasKey: false }])

    state.pending.value = true

    const { pending, hasKey } = useUserKeys()

    expect(pending.value).toBe(false)
    expect(hasKey('google')).toBe(false)
  })

  it('fails open for an id the summary does not mention', () => {
    useSummary([{ provider: 'google', hasKey: false }])

    const { hasKey, hasKeyForProvider } = useUserKeys()

    expect(hasKey('cloudflare-gateway')).toBe(true)
    expect(hasKeyForProvider('not-a-provider')).toBe(true)
  })

  it('reflects a newly saved key after a refresh', async () => {
    const state = useSummary([{ provider: 'google', hasKey: false }])

    mocks.refresh.mockImplementation(async () => {
      state.data.value = { keys: [{ provider: 'google', hasKey: true }] }
    })

    const { hasKey, refresh } = useUserKeys()

    expect(hasKey('google')).toBe(false)

    await refresh()

    expect(hasKey('google')).toBe(true)
  })

  it('reflects a deleted key after a refresh', async () => {
    const state = useSummary([{ provider: 'google', hasKey: true }])

    mocks.refresh.mockImplementation(async () => {
      state.data.value = { keys: [{ provider: 'google', hasKey: false }] }
    })

    const { hasKey, refresh } = useUserKeys()

    expect(hasKey('google')).toBe(true)

    await refresh()

    expect(hasKey('google')).toBe(false)
  })

  it('reports a saved and a missing key status per provider and gateway', () => {
    useSummary([
      { provider: 'anthropic', hasKey: true },
      { provider: 'openai', hasKey: false },
      { provider: 'vercel-gateway', hasKey: true },
      { provider: 'cloudflare-gateway', hasKey: false },
    ])

    const { keyStatusForProvider } = useUserKeys()

    expect(keyStatusForProvider('anthropic')).toBe('saved')
    expect(keyStatusForProvider('openai')).toBe('missing')
    expect(keyStatusForProvider('vercel')).toBe('saved')
    expect(keyStatusForProvider('cloudflare')).toBe('missing')
  })

  it('reports unknown rather than saved while the summary is in flight', () => {
    useSummary(null, { pending: true })

    const { keyStatusForProvider } = useUserKeys()

    expect(keyStatusForProvider('anthropic')).toBe('unknown')
  })

  it('keeps the known status while a post-save refresh is in flight', () => {
    const state = useSummary([{ provider: 'anthropic', hasKey: true }])

    state.pending.value = true

    const { keyStatusForProvider } = useUserKeys()

    expect(keyStatusForProvider('anthropic')).toBe('saved')
  })

  it('reports unknown rather than saved when the summary request failed', () => {
    useSummary(null, { error: new Error('offline') })

    const { keyStatusForProvider } = useUserKeys()

    expect(keyStatusForProvider('anthropic')).toBe('unknown')
  })

  it('reports unknown for an id no provider metadata maps', () => {
    useSummary([{ provider: 'google', hasKey: true }])

    const { keyStatusForProvider } = useUserKeys()

    expect(keyStatusForProvider('not-a-provider')).toBe('unknown')
    expect(keyStatusForProvider('anthropic')).toBe('unknown')
  })

  it('reflects a refreshed summary in the key status', async () => {
    const state = useSummary([{ provider: 'google', hasKey: false }])

    mocks.refresh.mockImplementation(async () => {
      state.data.value = { keys: [{ provider: 'google', hasKey: true }] }
    })

    const { keyStatusForProvider, refresh } = useUserKeys()

    expect(keyStatusForProvider('google')).toBe('missing')

    await refresh()

    expect(keyStatusForProvider('google')).toBe('saved')
  })

  it('reports an account with no keys at all only when every entry is empty', () => {
    useSummary([
      { provider: 'google', hasKey: false },
      { provider: 'vercel-gateway', hasKey: false },
    ])

    expect(useUserKeys().hasAnyKey.value).toBe(false)

    useSummary([
      { provider: 'google', hasKey: false },
      { provider: 'vercel-gateway', hasKey: true },
    ])

    expect(useUserKeys().hasAnyKey.value).toBe(true)
  })
})
