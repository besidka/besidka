import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { nextTick, ref } from 'vue'
import type { Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoWebSearch } from '../../../app/composables/auto-web-search'
import { usePreferenceStorage } from '../../../app/composables/preference-storage'

const mocks = vi.hoisted(() => ({
  useLazyFetch: vi.fn(),
  keyStatus: 'saved' as 'saved' | 'missing' | 'unknown',
}))

mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)
mockNuxtImport('useUserKeys', () => {
  return () => ({
    keyStatusForProvider: () => mocks.keyStatus,
  })
})

interface FetchState {
  data: Ref<{ typesafeRoles: Record<string, boolean> | null } | null>
  status: Ref<string>
  execute: ReturnType<typeof vi.fn>
}

function withSettings(
  typesafeRoles: Record<string, boolean> | null,
  status = 'success',
): FetchState {
  const state: FetchState = {
    data: ref(status === 'success' ? { typesafeRoles } : null),
    status: ref(status),
    execute: vi.fn(async () => undefined),
  }

  mocks.useLazyFetch.mockReturnValue(state)

  return state
}

const prefStorage = usePreferenceStorage()

describe('useAutoWebSearch', () => {
  beforeEach(() => {
    mocks.useLazyFetch.mockReset()
    mocks.keyStatus = 'saved'
    prefStorage.removeItem('settings_web_search_auto')
  })

  afterEach(() => {
    prefStorage.removeItem('settings_web_search_auto')
  })

  it('fetches the role settings lazily, client side, and only with a saved '
    + 'key', async () => {
    const withKey = withSettings(null, 'idle')

    useAutoWebSearch()
    await nextTick()

    expect(mocks.useLazyFetch.mock.calls[0]?.[1]).toMatchObject({
      server: false,
      immediate: false,
      pick: ['typesafeRoles'],
    })
    expect(withKey.execute).toHaveBeenCalledTimes(1)

    mocks.keyStatus = 'missing'

    const withoutKey = withSettings(null, 'idle')

    useAutoWebSearch()
    await nextTick()

    expect(withoutKey.execute).not.toHaveBeenCalled()
  })

  it('is available only with a saved key and the role on', () => {
    withSettings(null)

    expect(useAutoWebSearch().isAvailable.value).toBe(true)

    withSettings({ autoWebSearch: false })

    expect(useAutoWebSearch().isAvailable.value).toBe(false)

    mocks.keyStatus = 'missing'
    withSettings(null)

    expect(useAutoWebSearch().isAvailable.value).toBe(false)
  })

  it('is not available while the role settings are loading', () => {
    withSettings(null, 'pending')

    expect(useAutoWebSearch().isAvailable.value).toBe(false)
  })

  it('persists the preference', () => {
    withSettings(null)

    const { isPreferred, setPreferred } = useAutoWebSearch()

    expect(isPreferred.value).toBe(false)

    setPreferred(true)

    expect(prefStorage.getItem('settings_web_search_auto')).toBe('on')
    expect(isPreferred.value).toBe(true)

    setPreferred(false)

    expect(isPreferred.value).toBe(false)
  })

  it('asks for auto only when preferred, with a provider, and not known '
    + 'to be unavailable', () => {
    withSettings(null)

    const { resolveWebSearchMode, setPreferred } = useAutoWebSearch()

    expect(resolveWebSearchMode(['web_search_brave'])).toBe('always')

    setPreferred(true)

    expect(resolveWebSearchMode(['web_search_brave'])).toBe('auto')
    expect(resolveWebSearchMode([])).toBe('always')
    expect(resolveWebSearchMode(['image_generation'])).toBe('always')
  })

  it('asks for always once the key or the role is known to be missing',
    () => {
      prefStorage.setItem('settings_web_search_auto', 'on')
      mocks.keyStatus = 'missing'
      withSettings(null)

      expect(useAutoWebSearch().resolveWebSearchMode(['web_search']))
        .toBe('always')

      mocks.keyStatus = 'saved'
      withSettings({ autoWebSearch: false })

      expect(useAutoWebSearch().resolveWebSearchMode(['web_search']))
        .toBe('always')
    })

  it('keeps auto while the key and the role are still loading', () => {
    prefStorage.setItem('settings_web_search_auto', 'on')
    mocks.keyStatus = 'unknown'
    withSettings(null, 'idle')

    expect(useAutoWebSearch().resolveWebSearchMode(['web_search']))
      .toBe('auto')
  })
})
