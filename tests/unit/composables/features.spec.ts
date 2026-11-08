import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import {
  useFeature,
  useFeatures,
  useIsAdmin,
} from '../../../app/composables/features'

const { fetchMock, warnMock, requestFetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  warnMock: vi.fn(),
  requestFetchMock: vi.fn(),
}))

mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useRequestFetch', () => () => requestFetchMock)

vi.mock('evlog/client', () => ({
  log: { warn: warnMock },
}))

const payload = {
  features: {
    'artifacts': { enabled: true, active: true, variant: null },
    'ui.side-panel-demo': { enabled: true, active: false, variant: 'wide' },
  },
  isAdmin: true,
}

describe('features composable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useFeatures().clearFeatures()
  })

  it('defaults every feature to off before any state exists', () => {
    expect(useFeature('artifacts').value).toEqual({
      enabled: false,
      active: false,
      variant: null,
    })
    expect(useIsAdmin().value).toBe(false)
  })

  it('returns all-false for a key the payload does not carry', async () => {
    fetchMock.mockResolvedValueOnce(payload)

    await useFeatures().refreshFeatures()

    expect(useFeature('unknown.flag' as never).value).toEqual({
      enabled: false,
      active: false,
      variant: null,
    })
    expect(useFeature('documents').value.enabled).toBe(false)
  })

  it('reads the refreshed state reactively', async () => {
    const artifacts = useFeature('artifacts')
    const panel = useFeature('ui.side-panel-demo')
    const isAdmin = useIsAdmin()

    fetchMock.mockResolvedValueOnce(payload)

    await useFeatures().refreshFeatures()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/features')
    expect(artifacts.value.enabled).toBe(true)
    expect(panel.value).toEqual({
      enabled: true,
      active: false,
      variant: 'wide',
    })
    expect(isAdmin.value).toBe(true)
  })

  it('keeps the last known state when a refresh fails', async () => {
    fetchMock.mockResolvedValueOnce(payload)
    await useFeatures().refreshFeatures()

    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await useFeatures().refreshFeatures()

    expect(useFeature('artifacts').value.enabled).toBe(true)
    expect(warnMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'features-refresh',
    }))
  })

  it('clears the state', async () => {
    fetchMock.mockResolvedValueOnce(payload)
    await useFeatures().refreshFeatures()

    useFeatures().clearFeatures()

    expect(useFeatures().features.value).toBeNull()
    expect(useFeature('artifacts').value.enabled).toBe(false)
  })

  it('ignores a refresh that finishes after a newer one', async () => {
    let resolveSlow: (value: unknown) => void = () => {}

    fetchMock
      .mockImplementationOnce(() => {
        return new Promise((resolve) => {
          resolveSlow = resolve
        })
      })
      .mockResolvedValueOnce({ features: {}, isAdmin: false })

    const slow = useFeatures().refreshFeatures()

    await useFeatures().refreshFeatures()
    resolveSlow(payload)
    await slow

    expect(useIsAdmin().value).toBe(false)
  })

  it('does not repopulate state when cleared during a refresh', async () => {
    let resolveFetch: (value: unknown) => void = () => {}

    fetchMock.mockImplementationOnce(() => {
      return new Promise((resolve) => {
        resolveFetch = resolve
      })
    })

    const pending = useFeatures().refreshFeatures()

    useFeatures().clearFeatures()
    resolveFetch(payload)
    await pending

    expect(useFeatures().features.value).toBeNull()
  })

  it('calls the features:changed hook after a refresh', async () => {
    const listener = vi.fn()
    const removeHook = useNuxtApp().hook('features:changed', listener)

    fetchMock.mockResolvedValueOnce(payload)
    await useFeatures().refreshFeatures()
    removeHook()

    expect(listener).toHaveBeenCalledWith(payload)
  })

  it('fills the state from the server on an uncached SSR render', async () => {
    requestFetchMock.mockResolvedValueOnce(payload)

    await useFeatures().prefillServerFeatures({ serverRendered: true })

    expect(requestFetchMock).toHaveBeenCalledWith('/api/v1/features')
    expect(useFeatures().features.value).toEqual(payload)
  })

  it('skips the SSR fill on cached or prerendered responses', async () => {
    const { prefillServerFeatures, features } = useFeatures()

    await prefillServerFeatures({ serverRendered: true, isCached: true })
    await prefillServerFeatures({ serverRendered: true, prerenderedAt: 1 })
    await prefillServerFeatures({ serverRendered: false })

    expect(requestFetchMock).not.toHaveBeenCalled()
    expect(features.value).toBeNull()
  })

  it('leaves the state empty when the SSR fill fails', async () => {
    requestFetchMock.mockRejectedValueOnce(new Error('d1 down'))

    await useFeatures().prefillServerFeatures({ serverRendered: true })

    expect(useFeatures().features.value).toBeNull()
  })

  it('never writes feature state to browser storage (C11)', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const cookieBefore = document.cookie

    fetchMock.mockResolvedValueOnce(payload)
    await useFeatures().refreshFeatures()

    expect(setItem).not.toHaveBeenCalled()
    expect(document.cookie).toBe(cookieBefore)

    setItem.mockRestore()
  })
})
