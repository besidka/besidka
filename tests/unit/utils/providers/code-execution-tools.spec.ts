import type { Model } from '#shared/types/providers.d'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  model: undefined as Model | undefined,
}))

vi.mock('#shared/utils/model', () => ({
  getModel: vi.fn(() => ({ model: mocks.model })),
  getControllerModelId: (model: Model) => model.id,
  getImageGenerationModelId: (_model: Model, fallback: string) => fallback,
}))

function createModel(id: string): Model {
  return {
    id,
    name: id,
    description: 'test',
    contextLength: 100_000,
    maxOutputTokens: 8_000,
    price: { tokens: 1_000_000, input: '1', output: '1' },
    priceTier: '$',
    modalities: { input: ['text'], output: ['text'] },
    tools: ['web_search', 'code_execution'],
    toolCall: true,
    reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
  }
}

function stubKeyLookup() {
  vi.stubGlobal('useDb', () => ({
    query: {
      keys: { findFirst: vi.fn(async () => ({ apiKey: 'encrypted-key' })) },
    },
  }))
  vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
}

describe('provider code execution tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
  })

  describe('Anthropic', () => {
    async function load() {
      return (await import('~~/server/utils/providers/anthropic')).useAnthropic
    }

    it('registers code execution without forcing a tool choice', async () => {
      mocks.model = createModel('claude-haiku-5-5')

      const useAnthropic = await load()
      const result = await useAnthropic(
        '1',
        'claude-haiku-5-5',
        ['code_execution'],
        'off',
      )

      expect(Object.keys(result.tools.tools ?? {})).toEqual(['code_execution'])
      expect(result.tools.tools?.code_execution.id)
        .toBe('anthropic.code_execution_20260120')
      expect(result.tools.toolChoice).toBeUndefined()
      expect(result.tools.exclusiveNativeWebSearch).toBeUndefined()
    })

    it('registers it next to web search and nothing when not requested', async () => {
      mocks.model = createModel('claude-haiku-5-5')

      const useAnthropic = await load()
      const both = await useAnthropic(
        '1',
        'claude-haiku-5-5',
        ['web_search', 'code_execution'],
        'off',
      )
      const none = await useAnthropic('1', 'claude-haiku-5-5', [], 'off')

      expect(Object.keys(both.tools.tools ?? {}).sort()).toEqual([
        'code_execution',
        'web_search_preview',
      ])
      expect(none.tools.tools).toBeUndefined()
    })
  })

  describe('OpenAI', () => {
    async function load() {
      return (await import('~~/server/utils/providers/openai')).useOpenAI
    }

    it('registers the code interpreter under the shared tool name', async () => {
      mocks.model = createModel('gpt-6-luna')

      const useOpenAI = await load()
      const result = await useOpenAI(
        '1',
        'gpt-6-luna',
        ['code_execution'],
        'off',
      )

      expect(Object.keys(result.tools.tools ?? {})).toEqual(['code_execution'])
      expect(result.tools.tools?.code_execution.id)
        .toBe('openai.code_interpreter')
      expect(result.tools.toolChoice).toBeUndefined()
    })

    it('hands uploaded input files to the container as file ids', async () => {
      mocks.model = createModel('gpt-6-luna')

      const useOpenAI = await load()
      const result = await useOpenAI(
        '1',
        'gpt-6-luna',
        ['code_execution'],
        'off',
        undefined,
        ['file_a', 'file_b'],
      )

      expect(result.tools.tools?.code_execution.args).toEqual({
        container: { fileIds: ['file_a', 'file_b'] },
      })
    })

    it('never enables sandbox network access or a network policy', async () => {
      mocks.model = createModel('gpt-6-luna')

      const useOpenAI = await load()
      const result = await useOpenAI(
        '1',
        'gpt-6-luna',
        ['code_execution'],
        'off',
        undefined,
        ['file_a'],
      )
      const serialized = JSON.stringify(result.tools.tools?.code_execution)

      expect(serialized).not.toMatch(/network/i)
      expect(serialized).not.toMatch(/allowlist|allowed_domains|domain/i)
    })

    it('stops forcing web search once code execution is also requested', async () => {
      mocks.model = createModel('gpt-6-luna')

      const useOpenAI = await load()
      const search = await useOpenAI('1', 'gpt-6-luna', ['web_search'], 'off')
      const both = await useOpenAI(
        '1',
        'gpt-6-luna',
        ['web_search', 'code_execution'],
        'off',
      )

      expect(search.tools.toolChoice).toEqual({
        type: 'tool',
        toolName: 'web_search_preview',
      })
      expect(both.tools.toolChoice).toBeUndefined()
      expect(Object.keys(both.tools.tools ?? {}).sort()).toEqual([
        'code_execution',
        'web_search_preview',
      ])
    })
  })

  describe('Google', () => {
    async function load() {
      return (await import('~~/server/utils/providers/google')).useGoogle
    }

    it('registers Gemini code execution next to app tools on Gemini 3 and later', async () => {
      mocks.model = createModel('gemini-3.8-flash')

      const useGoogle = await load()
      const result = await useGoogle(
        '1',
        'gemini-3.8-flash',
        ['code_execution'],
        'off',
      )

      expect(Object.keys(result.tools.tools ?? {})).toEqual(['code_execution'])
      expect(result.tools.tools?.code_execution.id)
        .toBe('google.code_execution')
      expect(result.tools.exclusiveNativeWebSearch).toBeUndefined()
    })

    it('keeps Gemini 2.5 exclusive, because mixing with function calling is unverified there', async () => {
      mocks.model = createModel('gemini-2.5-flash')

      const useGoogle = await load()
      const result = await useGoogle(
        '1',
        'gemini-2.5-flash',
        ['code_execution'],
        'off',
      )

      expect(result.tools.exclusiveNativeWebSearch).toBe(true)
    })

    it('registers nothing when it was not requested', async () => {
      mocks.model = createModel('gemini-3.8-flash')

      const useGoogle = await load()
      const result = await useGoogle('1', 'gemini-3.8-flash', [], 'off')

      expect(result.tools).toEqual({})
    })
  })
})
