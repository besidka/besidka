import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultModel } from '../../../providers'
import { useUserModel } from '../../../app/composables/model'
import { parseModelSelection } from '../../../shared/utils/model-selection'

describe('parseModelSelection', () => {
  it('returns the bare model id as-is', () => {
    expect(parseModelSelection('gemini-2.5-flash', 'fallback-model'))
      .toEqual({ source: 'provider', modelId: 'gemini-2.5-flash' })
  })

  it('falls back to the default model when nothing is stored', () => {
    expect(parseModelSelection(null, 'fallback-model'))
      .toEqual({ source: 'provider', modelId: 'fallback-model' })
    expect(parseModelSelection('', 'fallback-model'))
      .toEqual({ source: 'provider', modelId: 'fallback-model' })
  })

  it('falls back to the raw legacy value for a JSON-shaped string that '
    + 'is not valid JSON, instead of throwing', () => {
    expect(parseModelSelection('{not json at all', 'fallback-model'))
      .toEqual({ source: 'provider', modelId: '{not json at all' })
  })

  it('round-trips a gateway JSON selection instead of degrading to the '
    + 'fallback model id', () => {
    const raw = JSON.stringify({
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: 'openai/gpt-5',
    })

    expect(parseModelSelection(raw, 'fallback-model')).toEqual({
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: 'openai/gpt-5',
    })
  })

  it('falls back to the default model for a structurally invalid gateway '
    + 'selection', () => {
    const raw = JSON.stringify({
      source: 'gateway',
      gatewayId: 'not-a-real-gateway',
      modelId: 'openai/gpt-5',
    })

    expect(parseModelSelection(raw, 'fallback-model'))
      .toEqual({ source: 'provider', modelId: raw })
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

  it('round-trips a stored gateway selection through `selection` instead '
    + 'of degrading to the fallback model id', () => {
    localStorage.setItem('model', JSON.stringify({
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: 'openai/gpt-5',
    }))

    const { selection, userModel } = useUserModel()

    expect(selection.value).toEqual({
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: 'openai/gpt-5',
    })
    expect(userModel.value).toBe('openai/gpt-5')
  })
})
