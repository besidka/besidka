import { describe, expect, it } from 'vitest'
import {
  MAX_PASTED_TEXTS,
  createPastedText,
  getPastedTextSize,
  joinMessageWithPastedTexts,
} from '../../../app/utils/pasted-text'

describe('pasted text utils', () => {
  it('appends pasted blocks after the typed text with a blank line', () => {
    expect(joinMessageWithPastedTexts('Summarize these:\n\n', [
      { content: 'first block' },
      { content: 'second block' },
    ])).toBe('Summarize these:\n\nfirst block\n\nsecond block')
  })

  it('sends only the pasted blocks when nothing was typed', () => {
    expect(joinMessageWithPastedTexts('  \n', [
      { content: 'only block' },
      { content: 'another' },
    ])).toBe('only block\n\nanother')
  })

  it('keeps the typed text verbatim when there is nothing pasted', () => {
    expect(joinMessageWithPastedTexts('  hello\n', [])).toBe('  hello\n')
    expect(joinMessageWithPastedTexts('hello', [{ content: '  \n ' }]))
      .toBe('hello')
  })

  it('keeps the pasted content unchanged', () => {
    const content = '\tindented\n\n- list\n'

    expect(joinMessageWithPastedTexts('', [{ content }])).toBe(content)
  })

  it('creates pasted texts with distinct ids', () => {
    const first = createPastedText('a')
    const second = createPastedText('a')

    expect(first.content).toBe('a')
    expect(first.id).toMatch(/^pasted-/)
    expect(first.id).not.toBe(second.id)
  })

  it('measures the size in UTF-8 bytes', () => {
    expect(getPastedTextSize('abc')).toBe(3)
    expect(getPastedTextSize('ї')).toBe(2)
  })

  it('caps pending pasted texts at ten', () => {
    expect(MAX_PASTED_TEXTS).toBe(10)
  })
})
