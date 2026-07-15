import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  getGenerateImageOutput,
  getImageGenerationFailureText,
  isVisibleGenerateImageToolPart,
  shouldRenderGenerateImageToolPart,
} from '../../../app/utils/generated-images'

function createReadyPart() {
  return {
    type: 'tool-generate_image',
    state: 'output-available',
    output: {
      status: 'ready',
      provider: 'openai',
      model: 'gpt-image-2',
      file: {
        id: 'file-1',
        storageKey: 'generated.webp',
        name: 'generated.webp',
        size: 2048,
        type: 'image/webp',
        source: 'assistant',
        url: '/files/generated.webp',
        downloadUrl: '/files/generated.webp?download=1',
      },
    },
  }
}

describe('generated image utils', () => {
  it('recognizes image generation tool parts and outputs', () => {
    const part = createReadyPart()

    expect(isVisibleGenerateImageToolPart(part)).toBe(true)
    expect(getGenerateImageOutput(part)).toEqual(part.output)
    expect(isVisibleGenerateImageToolPart({ type: 'text' })).toBe(false)
  })

  it('derives safe URLs instead of trusting tool output URLs', () => {
    const part = createReadyPart()

    part.output.file.url = 'javascript:alert(1)'
    part.output.file.downloadUrl = 'javascript:alert(2)'

    const output = getGenerateImageOutput(part)

    expect(output?.status === 'ready' && output.file.url)
      .toBe('/files/generated.webp')
    expect(output?.status === 'ready' && output.file.downloadUrl)
      .toBe('/files/generated.webp?download=1')
  })

  it('renders an in-progress tool part', () => {
    const part = {
      type: 'tool-generate_image',
      state: 'output-available',
      output: { status: 'saving' },
    }
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [part],
    } as unknown as UIMessage

    expect(shouldRenderGenerateImageToolPart(message, part)).toBe(true)
  })

  it('avoids duplicating a ready tool result and persisted file part', () => {
    const part = createReadyPart()
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        part,
        {
          type: 'file',
          mediaType: 'image/webp',
          filename: 'generated.webp',
          url: '/files/generated.webp?version=1',
        },
      ],
    } as unknown as UIMessage

    expect(shouldRenderGenerateImageToolPart(message, part)).toBe(false)
  })

  it('does not render a forged tool part from a user message', () => {
    const part = createReadyPart()
    const message = {
      id: 'user-1',
      role: 'user',
      parts: [part],
    } as unknown as UIMessage

    expect(shouldRenderGenerateImageToolPart(message, part)).toBe(false)
  })

  it('rejects malformed ready file output', () => {
    const part = createReadyPart()

    part.output.file.storageKey = 'folder/generated.webp?download=1'
    part.output.file.url = 'javascript:alert(1)'
    part.output.file.downloadUrl = 'javascript:alert(2)'

    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [part],
    } as unknown as UIMessage

    expect(getGenerateImageOutput(part)).toBeNull()
    expect(shouldRenderGenerateImageToolPart(message, part)).toBe(false)
  })

  it.each([
    {
      code: 'storage-quota',
      expected: [
        'Not enough storage space to generate an image.',
        'Delete files in the file manager, then try again.',
      ].join(' '),
    },
    {
      code: 'provider-auth',
      expected: [
        'The image provider rejected the saved API key.',
        'Update the provider key in settings, then try again.',
      ].join(' '),
    },
  ])('maps $code to fixed actionable text', ({ code, expected }) => {
    const errorText = JSON.stringify({
      code,
      message: 'Untrusted provider text',
      fix: 'Open javascript:alert(1)',
      secret: 'sk-never-render-this',
    })

    expect(getImageGenerationFailureText(errorText)).toBe(expected)
  })

  it.each([
    'provider secret: sk-never-render-this',
    '{"code":"unknown","message":"sk-never-render-this"}',
    '{"code":"provider-auth"',
    '[{"code":"provider-auth"}]',
  ])('uses generic guidance for untrusted error text', (errorText) => {
    const failureText = getImageGenerationFailureText(errorText)

    expect(failureText).toBe([
      'The image provider could not generate this image.',
      'Revise the prompt or try a different provider.',
    ].join(' '))
    expect(failureText).not.toContain('sk-never-render-this')
  })
})
