import { describe, expect, it } from 'vitest'
import anthropic from '../../../../providers/anthropic'
import deepseek from '../../../../providers/deepseek'
import google from '../../../../providers/google'
import moonshotai from '../../../../providers/moonshotai'
import openai from '../../../../providers/openai'
import qwen from '../../../../providers/qwen'
import xai from '../../../../providers/xai'

type ProviderModels = { models: Array<{ id: string, tools: string[] }> }

function idsWithCodeExecution(provider: ProviderModels) {
  return provider.models
    .filter(model => model.tools.includes('code_execution'))
    .map(model => model.id)
}

function idsWithout(provider: ProviderModels) {
  return provider.models
    .filter(model => !model.tools.includes('code_execution'))
    .map(model => model.id)
}

describe('code_execution model flags', () => {
  it('flags every curated Anthropic model: the code execution page lists them all', () => {
    expect(idsWithout(anthropic)).toEqual([])
    expect(idsWithCodeExecution(anthropic)).toEqual(expect.arrayContaining([
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-haiku-4-5',
    ]))
  })

  it('flags the OpenAI models whose page lists the code interpreter and not o1, research, image or legacy models', () => {
    const without = idsWithout(openai)

    expect(without).toEqual(expect.arrayContaining([
      'o1',
      'o3-deep-research',
      'o4-mini-deep-research',
      'gpt-image-2',
      'gpt-4-turbo',
      'gpt-4',
      'gpt-3.5-turbo',
    ]))
    expect(idsWithCodeExecution(openai)).toEqual(expect.arrayContaining([
      'gpt-6-luna',
      'gpt-6-sol',
      'gpt-5.5',
      'gpt-5-mini',
      'o3',
      'o4-mini',
      'gpt-4.1',
      'gpt-4o',
    ]))
  })

  it('flags Gemini text models only, not Deep Research or image models', () => {
    const without = idsWithout(google)

    expect(without).toEqual(expect.arrayContaining([
      'deep-research-preview-04-2026',
      'gemini-3.1-flash-image',
      'gemini-2.5-flash-image',
    ]))
    expect(idsWithCodeExecution(google)).toEqual(expect.arrayContaining([
      'gemini-3.8-flash',
      'gemini-2.5-flash',
    ]))
  })

  it('never flags a provider without a sandbox', () => {
    for (const provider of [xai, deepseek, moonshotai, qwen]) {
      expect(idsWithCodeExecution(provider)).toEqual([])
    }
  })
})
