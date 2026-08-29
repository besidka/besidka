import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultModel } from '../../../providers'
import { useUserModel } from '../../../app/composables/model'
import { parseModelSelection } from '../../../shared/utils/model-selection'

describe('parseModelSelection', () => {
  it('returns the bare model id as-is', () => {
    expect(parseModelSelection('gemini-2.5-flash', 'fallback-model'))
      .toBe('gemini-2.5-flash')
  })

  it('falls back to the default model when nothing is stored', () => {
    expect(parseModelSelection(null, 'fallback-model'))
      .toBe('fallback-model')
    expect(parseModelSelection('', 'fallback-model'))
      .toBe('fallback-model')
  })

  it('falls back to the default model for a JSON-shaped legacy value '
    + 'instead of leaking the raw JSON onward as a model id', () => {
    expect(parseModelSelection('{not json at all', 'fallback-model'))
      .toBe('fallback-model')
  })
})

describe('useUserModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('loads a stored model id as-is', () => {
    localStorage.setItem('model', 'gpt-5.4')

    const { userModel } = useUserModel()

    expect(userModel.value).toBe('gpt-5.4')
  })

  it('falls back to the build-time default model', () => {
    const { userModel } = useUserModel()

    expect(userModel.value).toBe(defaultModel)
  })

  it('writes a plain model id to local storage', () => {
    const { userModel } = useUserModel()

    userModel.value = 'gpt-5.4'

    expect(localStorage.getItem('model')).toBe('gpt-5.4')
  })

  it('survives a corrupt stored value', () => {
    localStorage.setItem('model', '{"source":"gateway"')

    const { userModel } = useUserModel()

    expect(userModel.value).toBe(defaultModel)
  })

  it('falls back to the default model when a stored model id no '
    + 'longer exists in the curated catalog', () => {
    localStorage.setItem('model', 'kimi-k2.5')

    const { userModel } = useUserModel()

    expect(userModel.value).toBe(defaultModel)
  })
})
