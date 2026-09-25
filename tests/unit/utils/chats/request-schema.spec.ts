import { describe, expect, it } from 'vitest'
import { chatToolsSchema } from '../../../../server/utils/chats/request-schema'

function messages(result: ReturnType<typeof chatToolsSchema.safeParse>) {
  if (result.success) {
    return []
  }

  return result.error.issues.map(issue => issue.message)
}

describe('chatToolsSchema', () => {
  it('accepts an empty tool list', () => {
    const result = chatToolsSchema.safeParse([])

    expect(result.success).toBe(true)
  })

  it('accepts a single native web search tool', () => {
    const result = chatToolsSchema.safeParse(['web_search'])

    expect(result.success).toBe(true)
  })

  it('accepts a single Brave web search tool', () => {
    const result = chatToolsSchema.safeParse(['web_search_brave'])

    expect(result.success).toBe(true)
  })

  it('accepts a single Exa web search tool', () => {
    const result = chatToolsSchema.safeParse(['web_search_exa'])

    expect(result.success).toBe(true)
  })

  it('accepts image generation alone', () => {
    const result = chatToolsSchema.safeParse(['image_generation'])

    expect(result.success).toBe(true)
  })

  it('rejects two web search providers selected together', () => {
    const result = chatToolsSchema.safeParse([
      'web_search',
      'web_search_brave',
    ])

    expect(result.success).toBe(false)
    expect(messages(result)).toContain(
      'Only one web search provider may be selected per message.',
    )
  })

  it('rejects Brave and Exa selected together', () => {
    const result = chatToolsSchema.safeParse([
      'web_search_brave',
      'web_search_exa',
    ])

    expect(result.success).toBe(false)
    expect(messages(result)).toContain(
      'Only one web search provider may be selected per message.',
    )
  })

  it('rejects native web search combined with image generation', () => {
    const result = chatToolsSchema.safeParse([
      'web_search',
      'image_generation',
    ])

    expect(result.success).toBe(false)
    expect(messages(result)).toContain(
      'Web search and image generation cannot be combined.',
    )
  })

  it('rejects Brave web search combined with image generation', () => {
    const result = chatToolsSchema.safeParse([
      'web_search_brave',
      'image_generation',
    ])

    expect(result.success).toBe(false)
    expect(messages(result)).toContain(
      'Web search and image generation cannot be combined.',
    )
  })

  it('rejects Exa web search combined with image generation', () => {
    const result = chatToolsSchema.safeParse([
      'web_search_exa',
      'image_generation',
    ])

    expect(result.success).toBe(false)
    expect(messages(result)).toContain(
      'Web search and image generation cannot be combined.',
    )
  })

  it('rejects an unknown tool value', () => {
    const result = chatToolsSchema.safeParse(['not_a_real_tool'])

    expect(result.success).toBe(false)
  })
})
