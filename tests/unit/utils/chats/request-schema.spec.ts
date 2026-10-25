import { describe, expect, it } from 'vitest'
import {
  chatToolsSchema,
  incomingUserMessageSchema,
  MAX_USER_MESSAGE_FILE_NAME_LENGTH,
  MAX_USER_MESSAGE_ID_LENGTH,
  MAX_USER_MESSAGE_PARTS,
  MAX_USER_MESSAGE_FILE_URL_LENGTH,
  MAX_USER_MESSAGE_TEXT_LENGTH,
  userMessagePartsSchema,
} from '../../../../server/utils/chats/request-schema'

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

describe('userMessagePartsSchema', () => {
  it('accepts a normal text part', () => {
    const result = userMessagePartsSchema.safeParse([
      { type: 'text', text: 'Hello there' },
    ])

    expect(result.success).toBe(true)
  })

  it('accepts a text part exactly at the length limit', () => {
    const result = userMessagePartsSchema.safeParse([
      { type: 'text', text: 'a'.repeat(MAX_USER_MESSAGE_TEXT_LENGTH) },
    ])

    expect(result.success).toBe(true)
  })

  it('rejects a text part above the length limit', () => {
    const result = userMessagePartsSchema.safeParse([
      {
        type: 'text',
        text: 'a'.repeat(MAX_USER_MESSAGE_TEXT_LENGTH + 1),
      },
    ])

    expect(result.success).toBe(false)
  })

  it('rejects more parts than the limit', () => {
    const parts = [
      { type: 'text', text: 'Hello' },
      ...Array.from({ length: MAX_USER_MESSAGE_PARTS }, () => {
        return {
          type: 'file',
          mediaType: 'image/png',
          url: 'https://example.com/a.png',
        }
      }),
    ]

    expect(userMessagePartsSchema.safeParse(parts).success).toBe(false)
  })

  it('rejects an oversized file name and media type', () => {
    const longValue = 'a'.repeat(MAX_USER_MESSAGE_FILE_NAME_LENGTH + 1)

    expect(userMessagePartsSchema.safeParse([
      { type: 'text', text: 'Hello' },
      {
        type: 'file',
        mediaType: 'image/png',
        filename: longValue,
        url: 'https://example.com/a.png',
      },
    ]).success).toBe(false)

    expect(userMessagePartsSchema.safeParse([
      { type: 'text', text: 'Hello' },
      {
        type: 'file',
        mediaType: longValue,
        url: 'https://example.com/a.png',
      },
    ]).success).toBe(false)
  })

  it('rejects text parts whose combined length exceeds the limit', () => {
    const halfLimit = MAX_USER_MESSAGE_TEXT_LENGTH / 2
    const result = userMessagePartsSchema.safeParse([
      { type: 'text', text: 'a'.repeat(halfLimit) },
      { type: 'text', text: 'a'.repeat(halfLimit + 1) },
    ])

    expect(result.success).toBe(false)
    expect(messages(result)).toContain(
      'The combined text of all parts is too long.',
    )
  })

  it('rejects many maximum-size text parts', () => {
    const parts = Array.from({ length: MAX_USER_MESSAGE_PARTS }, () => {
      return { type: 'text', text: 'a'.repeat(MAX_USER_MESSAGE_TEXT_LENGTH) }
    })

    expect(userMessagePartsSchema.safeParse(parts).success).toBe(false)
  })

  it('accepts text parts whose combined length is exactly the limit', () => {
    const halfLimit = MAX_USER_MESSAGE_TEXT_LENGTH / 2
    const result = userMessagePartsSchema.safeParse([
      { type: 'text', text: 'a'.repeat(halfLimit) },
      { type: 'text', text: 'a'.repeat(halfLimit) },
    ])

    expect(result.success).toBe(true)
  })

  it('does not count file parts toward the combined text limit', () => {
    const result = userMessagePartsSchema.safeParse([
      { type: 'text', text: 'a'.repeat(MAX_USER_MESSAGE_TEXT_LENGTH) },
      {
        type: 'file',
        mediaType: 'image/png',
        url: 'https://example.com/a.png',
      },
    ])

    expect(result.success).toBe(true)
  })

  it('rejects a file url above the length limit', () => {
    const result = userMessagePartsSchema.safeParse([
      { type: 'text', text: 'Hello' },
      {
        type: 'file',
        mediaType: 'image/png',
        url: `https://example.com/${'a'.repeat(MAX_USER_MESSAGE_FILE_URL_LENGTH)}`,
      },
    ])

    expect(result.success).toBe(false)
  })

  it('accepts a file url exactly at the length limit', () => {
    const prefix = 'https://example.com/'
    const result = userMessagePartsSchema.safeParse([
      { type: 'text', text: 'Hello' },
      {
        type: 'file',
        mediaType: 'image/png',
        url: prefix + 'a'.repeat(
          MAX_USER_MESSAGE_FILE_URL_LENGTH - prefix.length,
        ),
      },
    ])

    expect(result.success).toBe(true)
  })
})

describe('incomingUserMessageSchema', () => {
  it('accepts a normal message', () => {
    const result = incomingUserMessageSchema.safeParse({
      id: 'message-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello there' }],
    })

    expect(result.success).toBe(true)
  })

  it('rejects an oversized message id', () => {
    const result = incomingUserMessageSchema.safeParse({
      id: 'a'.repeat(MAX_USER_MESSAGE_ID_LENGTH + 1),
      role: 'user',
      parts: [{ type: 'text', text: 'Hello there' }],
    })

    expect(result.success).toBe(false)
  })
})
