import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { orderOutputCardPartsLast } from '../../../app/utils/artifact-parts'
import {
  hasGapBeforePart,
  isCardMessagePart,
} from '../../../app/utils/message-part-spacing'

const text = { type: 'text', text: 'Here is the answer.' }
const imageTool = {
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
const gatewayImage = {
  type: 'file',
  mediaType: 'image/webp',
  url: '/files/generated.webp',
}
const artifact = { type: 'tool-create_artifact', state: 'output-available' }
const document = { type: 'tool-create_document', state: 'output-available' }
const documentData = { type: 'data-document', data: {} }
const codeExecution = { type: 'tool-code_execution', state: 'output-available' }

function messageOf(parts: unknown[]): UIMessage {
  return { id: 'm1', role: 'assistant', parts } as unknown as UIMessage
}

function gapFor(parts: unknown[], index: number): boolean {
  const message = messageOf(parts)

  return hasGapBeforePart(message, message.parts, index)
}

describe('isCardMessagePart', () => {
  it.each([
    ['a generated image tool part', imageTool],
    ['a gateway image file part', gatewayImage],
    ['an artifact card', artifact],
    ['a document tool part', document],
    ['a document data part', documentData],
    ['a code execution card', codeExecution],
  ])('treats %s as a card', (_name, part) => {
    expect(isCardMessagePart(messageOf([part]), part)).toBe(true)
  })

  it('treats text, reasoning and skill parts as no card', () => {
    for (const part of [
      text,
      { type: 'reasoning', text: 'Thinking' },
      { type: 'data-skill-activation', data: {} },
      { type: 'tool-activate_skill' },
    ]) {
      expect(isCardMessagePart(messageOf([part]), part)).toBe(false)
    }
  })
})

describe('hasGapBeforePart', () => {
  it.each([
    ['a generated image', imageTool],
    ['a gateway image', gatewayImage],
    ['an artifact card', artifact],
    ['a document card', document],
    ['a document data part', documentData],
    ['a code execution card', codeExecution],
  ])('gives text right after %s a gap', (_name, card) => {
    expect(gapFor([card, text], 1)).toBe(true)
  })

  it('gives a card right after text a gap, whatever kind of card it is', () => {
    const cards = [imageTool, gatewayImage, artifact, document, codeExecution]

    for (const card of cards) {
      expect(gapFor([text, card], 1)).toBe(true)
    }
  })

  it('leaves a card that opens the message, and the text before a card, alone', () => {
    expect(gapFor([document, text], 0)).toBe(false)
    expect(gapFor([text, document], 0)).toBe(false)
  })

  it('leaves two texts and two cards alone', () => {
    expect(gapFor([text, text], 1)).toBe(false)
    expect(gapFor([artifact, document], 1)).toBe(false)
  })

  it('looks past parts that render nothing between a card and its text', () => {
    const stepStart = { type: 'step-start' }
    const source = { type: 'source-url', url: 'https://example.com' }
    const activation = { type: 'data-skill-activation', data: {} }
    const reasoning = { type: 'reasoning', text: 'Thinking' }

    expect(gapFor([document, stepStart, text], 2)).toBe(true)
    expect(gapFor([imageTool, source, activation, text], 3)).toBe(true)
    expect(gapFor([text, stepStart, reasoning, document], 3)).toBe(true)
    expect(gapFor([stepStart, text], 1)).toBe(false)
    expect(gapFor([text, stepStart, text], 2)).toBe(false)
  })

  it('does not treat an empty text part as the neighbour', () => {
    const empty = { type: 'text', text: '  ' }

    expect(gapFor([document, empty, text], 2)).toBe(true)
    expect(gapFor([text, empty, document], 2)).toBe(true)
  })

  it('counts an error text part as rendered text', () => {
    const failure = { type: 'text', text: '', error: { message: 'Failed' } }

    expect(gapFor([document, failure], 1)).toBe(true)
  })

  it('ignores a message with no card', () => {
    expect(gapFor([{ type: 'reasoning', text: 'x' }, text], 1)).toBe(false)
  })

  it('treats the output cards of one answer as one block after the text', () => {
    expect(gapFor([text, document, artifact], 1)).toBe(true)
    expect(gapFor([text, document, artifact], 2)).toBe(false)
  })
})

describe('a document card in an answer', () => {
  it('renders after the answer text and with a gap above it', () => {
    const rendered = orderOutputCardPartsLast([document, text])

    expect(rendered).toEqual([text, document])
    expect(gapFor(rendered, 1)).toBe(true)
  })

  it('keeps the text that follows a generated image apart from it', () => {
    const rendered = orderOutputCardPartsLast([imageTool, text])

    expect(rendered).toEqual([imageTool, text])
    expect(gapFor(rendered, 1)).toBe(true)
  })
})
