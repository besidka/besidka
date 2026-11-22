import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  evaluateFeature: vi.fn(),
  isFeatureActive: vi.fn(),
}))

vi.mock('~~/server/utils/features/evaluate', () => ({
  evaluateFeature: mocks.evaluateFeature,
  isFeatureActive: mocks.isFeatureActive,
}))

async function allowed(event: unknown, key: unknown) {
  const { isGooglePickerFrameAllowed } = await import(
    '~~/server/utils/google/picker-frame'
  )

  return await isGooglePickerFrameAllowed(event as never, key)
}

function eventWithFeatures(userState: unknown = { optIns: {} }) {
  return {
    context: { features: Promise.resolve({ userState }) },
  }
}

describe('isGooglePickerFrameAllowed', () => {
  beforeEach(() => {
    mocks.evaluateFeature.mockReset()
    mocks.isFeatureActive.mockReset()
    mocks.evaluateFeature.mockResolvedValue({ value: true })
  })

  it('answers no without the public Picker key and reads nothing', async () => {
    expect(await allowed(eventWithFeatures(), '')).toBe(false)
    expect(await allowed(eventWithFeatures(), null)).toBe(false)
    expect(mocks.evaluateFeature).not.toHaveBeenCalled()
  })

  it('falls back to the key alone when the render left no feature state',
    async () => {
      expect(await allowed({ context: {} }, 'public-key')).toBe(true)
      expect(mocks.evaluateFeature).not.toHaveBeenCalled()
    })

  it('answers yes for a user whose google.drive flag is active', async () => {
    mocks.isFeatureActive.mockReturnValue(true)

    const userState = { optIns: { 'google.drive': true } }

    expect(await allowed(eventWithFeatures(userState), 'public-key'))
      .toBe(true)
    expect(mocks.evaluateFeature).toHaveBeenCalledWith(
      'google.drive',
      expect.objectContaining({ userState }),
    )
    expect(mocks.isFeatureActive).toHaveBeenCalledWith(
      'google.drive',
      { value: true },
      userState,
    )
  })

  it('answers no for a user without the flag, with the key set', async () => {
    mocks.isFeatureActive.mockReturnValue(false)

    expect(await allowed(eventWithFeatures(), 'public-key')).toBe(false)
  })

  it('answers no when the feature state or its evaluation fails', async () => {
    const rejected = Promise.reject(new Error('state failed'))

    rejected.catch(() => undefined)

    expect(await allowed({ context: { features: rejected } }, 'public-key'))
      .toBe(false)

    mocks.evaluateFeature.mockRejectedValue(new Error('evaluation failed'))

    expect(await allowed(eventWithFeatures(), 'public-key')).toBe(false)
  })
})
