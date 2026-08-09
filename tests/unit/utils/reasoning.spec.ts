import { describe, expect, it } from 'vitest'
import {
  extractLastCompleteReasoningTitle,
  normalizeReasoningTitle,
  parseReasoningSections,
  truncateReasoningTitle,
} from '../../../app/utils/reasoning'

describe('reasoning utils', () => {
  it('parses structured reasoning sections', () => {
    const input = [
      '**Step 1**',
      '',
      'First body',
      '',
      '**Step 2**',
      '',
      'Second body',
    ].join('\n')

    expect(parseReasoningSections(input)).toEqual([
      {
        title: 'Step 1',
        body: 'First body',
      },
      {
        title: 'Step 2',
        body: 'Second body',
      },
    ])
  })

  it('falls back to first non-empty line when no title blocks are present', () => {
    const input = [
      '',
      'Fallback title',
      'Fallback body line 1',
      'Fallback body line 2',
    ].join('\n')

    expect(parseReasoningSections(input)).toEqual([
      {
        title: 'Fallback title',
        body: 'Fallback body line 1\nFallback body line 2',
      },
    ])
  })

  it('keeps leading fallback text before first titled section', () => {
    const input = [
      'Preface title',
      'Preface details',
      '',
      '**Step 1**',
      '',
      'First body',
    ].join('\n')

    expect(parseReasoningSections(input)).toEqual([
      {
        title: 'Preface title',
        body: 'Preface details',
      },
      {
        title: 'Step 1',
        body: 'First body',
      },
    ])
  })

  it('extracts only last complete title from streaming reasoning text', () => {
    const completed = [
      '**Step 1**',
      '',
      'One',
      '',
      '**Step 2**',
      '',
      'Two',
      '',
      '**Step 3**',
      '',
      'Three',
    ].join('\n')

    const partial = [
      '**Step 1**',
      '',
      'One',
      '',
      '**Step 2*',
    ].join('\n')

    expect(extractLastCompleteReasoningTitle(completed)).toBe('Step 3')
    expect(extractLastCompleteReasoningTitle(partial)).toBe('Step 1')
  })

  it('derives fallback title from sentence and comma for plain text', () => {
    const input = [
      'I\'m thinking about all the things I can assist with,',
      'like answering questions, explaining concepts, writing or',
      'editing, brainstorming ideas, offering code help,',
      'translating, summarizing text, and doing math. I want to',
      'make sure I\'m being helpful while keeping things concise.',
    ].join(' ')

    expect(parseReasoningSections(input)).toEqual([
      {
        title: 'I\'m thinking about all the things I can assist with',
        body: [
          'like answering questions, explaining concepts, writing or',
          'editing, brainstorming ideas, offering code help,',
          'translating, summarizing text, and doing math. I want to',
          'make sure I\'m being helpful while keeping things concise.',
        ].join(' '),
      },
    ])

    expect(extractLastCompleteReasoningTitle(input)).toBe(
      'I\'m thinking about all the things I can assist with',
    )
  })

  it('derives fallback title with multilingual sentence punctuation', () => {
    const input = [
      '我正在分析你的请求，准备一个简洁的答案。',
      '接下来我会给出可执行的步骤！',
    ].join(' ')

    expect(parseReasoningSections(input)).toEqual([
      {
        title: '我正在分析你的请求，准备一个简洁的答案',
        body: '接下来我会给出可执行的步骤！',
      },
    ])

    expect(extractLastCompleteReasoningTitle(input)).toBe(
      '我正在分析你的请求，准备一个简洁的答案',
    )
  })

  it('normalizes markdown-wrapped and empty titles', () => {
    expect(normalizeReasoningTitle('**Step 9**')).toBe('Step 9')
    expect(normalizeReasoningTitle('   ')).toBe('Reasoning')
  })

  it('leaves a title within the display limit untouched', () => {
    expect(truncateReasoningTitle('Step 9')).toBe('Step 9')
    expect(truncateReasoningTitle('Thinking about the request'))
      .toBe('Thinking about the request')
    expect(truncateReasoningTitle('Exactly thirty characters here'))
      .toBe('Exactly thirty characters here')
  })

  it('caps a long title at a word boundary with an ellipsis', () => {
    expect(
      truncateReasoningTitle(
        'Analyzing the request in considerable depth before answering',
      ),
    ).toBe('Analyzing the request in…')

    expect(
      truncateReasoningTitle(
        'I\'m thinking about all the things I can assist with',
      ),
    ).toBe('I\'m thinking about all the…')
  })

  it('keeps every capped title within a compact render width', () => {
    const titles = [
      'Analyzing the request in considerable depth before answering',
      'I\'m thinking about all the things I can assist with',
      'Supercalifragilisticexpialidociousandthensomemore',
      '我正在分析你的请求准备一个简洁的答案接下来我会给出可执行的步骤最后再检查一遍',
    ]

    for (const title of titles) {
      const truncated = truncateReasoningTitle(title)

      expect(truncated.length).toBeLessThanOrEqual(31)
      expect(truncated.endsWith('…')).toBe(true)
    }
  })

  it('hard-cuts a single long word that has no word boundary', () => {
    expect(
      truncateReasoningTitle('Supercalifragilisticexpialidociousandthensomemore'),
    ).toBe('Supercalifragilisticexpialidoc…')
  })

  it('does not emit a doubled ellipsis or dangling punctuation', () => {
    expect(truncateReasoningTitle('Considering the options…, then deciding'))
      .toBe('Considering the options…')

    expect(truncateReasoningTitle('Reviewing the plan, then writing the answer'))
      .toBe('Reviewing the plan, then…')
  })

  it('trims a title before measuring it', () => {
    expect(truncateReasoningTitle('   Step 9   ')).toBe('Step 9')
  })
})
