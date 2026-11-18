import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFeatureOptIn } from '../../../app/composables/feature-opt-in'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refreshFeatures: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useFeatures', () => {
  return () => ({ refreshFeatures: mocks.refreshFeatures })
})

describe('useFeatureOptIn', () => {
  beforeEach(() => {
    mocks.fetch.mockReset().mockResolvedValue({})
    mocks.refreshFeatures.mockReset().mockResolvedValue(undefined)
  })

  it('posts the opt-in for the flag, then refreshes the features', async () => {
    const { setFeatureOptIn } = useFeatureOptIn()

    await setFeatureOptIn('besidka-tools', true)

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/profiles/features/besidka-tools/opt-in',
      { method: 'POST', body: { optedIn: true } },
    )
    expect(mocks.refreshFeatures).toHaveBeenCalledTimes(1)
  })

  it('sends the opt-out the same way', async () => {
    const { setFeatureOptIn } = useFeatureOptIn()

    await setFeatureOptIn('besidka-tools', false)

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/profiles/features/besidka-tools/opt-in',
      { method: 'POST', body: { optedIn: false } },
    )
  })

  it('throws a failed save and does not refresh', async () => {
    mocks.fetch.mockRejectedValue(new Error('nope'))

    const { setFeatureOptIn } = useFeatureOptIn()

    await expect(setFeatureOptIn('besidka-tools', true)).rejects.toThrow('nope')
    expect(mocks.refreshFeatures).not.toHaveBeenCalled()
  })
})
