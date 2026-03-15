import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import {
  resolveDataUrlsInModelMessages,
} from '../../../server/utils/files/resolve-data-urls'

describe('resolveDataUrlsInModelMessages', () => {
  it('converts data: URL string in user file part to Uint8Array', () => {
    const base64 = btoa('hello')
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'file',
            mediaType: 'image/png',
            data: `data:image/png;base64,${base64}`,
          },
        ],
      },
    ]

    resolveDataUrlsInModelMessages(messages)

    const part = (messages[0] as any).content[0]

    expect(part.data).toBeInstanceOf(Uint8Array)
    expect(Array.from(part.data as Uint8Array)).toEqual(
      Array.from(new TextEncoder().encode('hello')),
    )
    expect(part.mediaType).toBe('image/png')
  })

  it('sets mediaType from data URL when not already present', () => {
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'file',
            data: `data:application/pdf;base64,${btoa('pdf')}`,
          },
        ],
      },
    ]

    resolveDataUrlsInModelMessages(messages)

    const part = (messages[0] as any).content[0]

    expect(part.mediaType).toBe('application/pdf')
  })

  it('does not override existing mediaType', () => {
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'file',
            mediaType: 'image/webp',
            data: `data:image/png;base64,${btoa('x')}`,
          },
        ],
      },
    ]

    resolveDataUrlsInModelMessages(messages)

    const part = (messages[0] as any).content[0]

    expect(part.mediaType).toBe('image/webp')
  })

  it('leaves non-file parts untouched', () => {
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'hello',
          },
        ],
      },
    ]

    resolveDataUrlsInModelMessages(messages)

    expect((messages[0] as any).content[0].text).toBe('hello')
  })

  it('leaves non-user messages untouched', () => {
    const dataUrl = `data:image/png;base64,${btoa('img')}`
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'file',
            mediaType: 'image/png',
            data: dataUrl,
          } as any,
        ],
      },
    ]

    resolveDataUrlsInModelMessages(messages)

    expect((messages[0] as any).content[0].data).toBe(dataUrl)
  })

  it('leaves already-binary data (Uint8Array) untouched', () => {
    const binary = new Uint8Array([1, 2, 3])
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'file',
            mediaType: 'image/png',
            data: binary,
          },
        ],
      },
    ]

    resolveDataUrlsInModelMessages(messages)

    expect((messages[0] as any).content[0].data).toBe(binary)
  })

  it('leaves malformed data: URL string untouched', () => {
    const malformed = 'data:image/png;notbase64,??'
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'file',
            mediaType: 'image/png',
            data: malformed,
          },
        ],
      },
    ]

    resolveDataUrlsInModelMessages(messages)

    expect((messages[0] as any).content[0].data).toBe(malformed)
  })

  it('handles multiple file parts in one message', () => {
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'file',
            mediaType: 'image/png',
            data: `data:image/png;base64,${btoa('a')}`,
          },
          {
            type: 'file',
            mediaType: 'application/pdf',
            data: `data:application/pdf;base64,${btoa('b')}`,
          },
        ],
      },
    ]

    resolveDataUrlsInModelMessages(messages)

    expect((messages[0] as any).content[0].data).toBeInstanceOf(Uint8Array)
    expect((messages[0] as any).content[1].data).toBeInstanceOf(Uint8Array)
  })

  it('returns the same messages array reference', () => {
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'hi' }],
      },
    ]

    const result = resolveDataUrlsInModelMessages(messages)

    expect(result).toBe(messages)
  })
})
