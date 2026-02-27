import { describe, expect, it } from 'vitest'
import {
  extractLastCompleteReasoningTitle,
  normalizeReasoningTitle,
  parseReasoningSections,
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
})
