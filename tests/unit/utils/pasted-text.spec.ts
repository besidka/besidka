import { describe, expect, it } from 'vitest'
import { MAX_USER_MESSAGE_TEXT_LENGTH } from '#shared/utils/chat-message-limits'
import {
  MAX_PASTED_TEXTS,
  createPastedText,
  formatCharacterCount,
  getMessageTextOverflow,
  getPastedTextSize,
  hasPastedTextContent,
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

  it('detects whether any pasted text has content', () => {
    expect(hasPastedTextContent([])).toBe(false)
    expect(hasPastedTextContent([{ content: ' \n\t' }])).toBe(false)
    expect(hasPastedTextContent([{ content: ' ' }, { content: 'x' }]))
      .toBe(true)
  })

  it('reports how far the joined text is over the message limit', () => {
    const half = 'a'.repeat(MAX_USER_MESSAGE_TEXT_LENGTH / 2)

    expect(getMessageTextOverflow('', [{ content: half }, { content: half }]))
      .toBe(2)
    expect(getMessageTextOverflow('', [{ content: half }])).toBe(0)
    expect(getMessageTextOverflow(
      'x'.repeat(MAX_USER_MESSAGE_TEXT_LENGTH),
      [],
    )).toBe(0)
    expect(getMessageTextOverflow(
      'x'.repeat(MAX_USER_MESSAGE_TEXT_LENGTH),
      [{ content: 'y' }],
    )).toBe(3)
  })

  it('formats character counts with thousands separators', () => {
    expect(formatCharacterCount(200000)).toBe('200,000')
  })

  it('caps pending pasted texts at ten', () => {
    expect(MAX_PASTED_TEXTS).toBe(10)
  })
})
