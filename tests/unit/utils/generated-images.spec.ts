import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { HIDDEN_FILE_MEDIA_TYPE } from '../../../shared/utils/files'
import {
  getGenerateImageOutput,
  getImageGenerationFailureText,
  isVisibleGenerateImageToolPart,
  shouldFitMessageBubble,
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

  it('appends a support reference when the error carries a request id', () => {
    const errorText = JSON.stringify({
      code: 'provider-auth',
      message: 'Untrusted provider text',
      requestId: 'cf-ray-abc123',
    })

    const failureText = getImageGenerationFailureText(errorText)

    expect(failureText).toContain(
      'The image provider rejected the saved API key.',
    )
    expect(failureText).toMatch(/ \(ref: [\w.:-]+\)$/)
    expect(failureText).toContain('(ref: cf-ray-abc123)')
  })

  it('prefers the provider request id over the platform request id', () => {
    const errorText = JSON.stringify({
      code: 'provider-auth',
      requestId: 'cf-ray-abc123',
      providerRequestId: 'openai-req-456',
    })

    expect(getImageGenerationFailureText(errorText))
      .toContain('(ref: openai-req-456)')
  })

  it('ignores a malformed or oversized request id', () => {
    const errorText = JSON.stringify({
      code: 'provider-auth',
      requestId: '<script>alert(1)</script>',
    })

    const failureText = getImageGenerationFailureText(errorText)

    expect(failureText).not.toContain('ref:')
    expect(failureText).not.toContain('<script>')
  })

  it('fits an assistant bubble containing only an image file part', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'step-start',
        },
        {
          type: 'file',
          mediaType: 'image/webp',
          filename: 'generated.webp',
          url: '/files/generated.webp',
        },
      ],
    } as unknown as UIMessage

    expect(shouldFitMessageBubble(message)).toBe(true)
  })

  it('keeps a bubble with text and an image at its normal width', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'text',
          text: 'Here is your image',
        },
        {
          type: 'file',
          mediaType: 'image/webp',
          filename: 'generated.webp',
          url: '/files/generated.webp',
        },
      ],
    } as unknown as UIMessage

    expect(shouldFitMessageBubble(message)).toBe(false)
  })

  it('keeps text-only and non-image file bubbles at their normal width', () => {
    const textMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Here is your image',
      }],
    } as unknown as UIMessage
    const fileMessage = {
      id: 'assistant-2',
      role: 'assistant',
      parts: [{
        type: 'file',
        mediaType: 'application/pdf',
        filename: 'report.pdf',
        url: '/files/report.pdf',
      }],
    } as unknown as UIMessage

    expect(shouldFitMessageBubble(textMessage)).toBe(false)
    expect(shouldFitMessageBubble(fileMessage)).toBe(false)
  })

  it('fits an assistant bubble containing only a hidden-file placeholder', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{
        type: 'file',
        mediaType: HIDDEN_FILE_MEDIA_TYPE,
        filename: undefined,
        url: '',
      }],
    } as unknown as UIMessage

    expect(shouldFitMessageBubble(message)).toBe(true)
  })

  it('never fits a user message even if it only carries an image', () => {
    const message = {
      id: 'user-1',
      role: 'user',
      parts: [{
        type: 'file',
        mediaType: 'image/webp',
        filename: 'upload.webp',
        url: '/files/upload.webp',
      }],
    } as unknown as UIMessage

    expect(shouldFitMessageBubble(message)).toBe(false)
  })
})
