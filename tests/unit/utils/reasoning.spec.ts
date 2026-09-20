import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  extractLastCompleteReasoningTitle,
  getToolPartName,
  getToolStepTitle,
  hasPendingToolPart,
  hasStreamingReasoningPart,
  isFailedToolPart,
  isThinkingActive,
  isThinkingToolPart,
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

describe('hasStreamingReasoningPart', () => {
  it('returns false for an empty or undefined parts list', () => {
    expect(hasStreamingReasoningPart(undefined)).toBe(false)
    expect(hasStreamingReasoningPart([])).toBe(false)
  })

  it('returns true when a reasoning part with text is streaming', () => {
    const parts: UIMessage['parts'] = [
      { type: 'reasoning', text: 'Thinking…', state: 'streaming' },
    ]

    expect(hasStreamingReasoningPart(parts)).toBe(true)
  })

  it('returns false once the reasoning part has settled to done', () => {
    const parts: UIMessage['parts'] = [
      { type: 'reasoning', text: 'Thinking…', state: 'done' },
    ]

    expect(hasStreamingReasoningPart(parts)).toBe(false)
  })

  it('ignores a streaming reasoning part with no text yet', () => {
    const parts: UIMessage['parts'] = [
      { type: 'reasoning', text: '', state: 'streaming' },
    ]

    expect(hasStreamingReasoningPart(parts)).toBe(false)
  })

  it('ignores non-reasoning parts, even a streaming text part', () => {
    const parts: UIMessage['parts'] = [
      { type: 'text', text: 'Answer', state: 'streaming' },
    ]

    expect(hasStreamingReasoningPart(parts)).toBe(false)
  })

  it('is true for a second reasoning part after an earlier one settled', () => {
    const parts: UIMessage['parts'] = [
      { type: 'reasoning', text: 'First pass', state: 'done' },
      { type: 'tool-web_search', state: 'input-available' },
      { type: 'reasoning', text: 'Second pass', state: 'streaming' },
    ]

    expect(hasStreamingReasoningPart(parts)).toBe(true)
  })
})

describe('isThinkingToolPart / getToolPartName', () => {
  it('names a static tool-prefixed part and treats it as a thinking part', () => {
    const part = {
      type: 'tool-web_search_preview',
      state: 'input-available',
    } as UIMessage['parts'][number]

    expect(getToolPartName(part)).toBe('web_search_preview')
    expect(isThinkingToolPart(part)).toBe(true)
  })

  it('never treats a generate_image tool part as a thinking part', () => {
    const states = ['input-streaming', 'input-available', 'output-available', 'output-error']

    for (const state of states) {
      const part = {
        type: 'tool-generate_image',
        state,
      } as UIMessage['parts'][number]

      expect(getToolPartName(part)).toBe('generate_image')
      expect(isThinkingToolPart(part)).toBe(false)
    }
  })

  it('names a dynamic-tool part from its toolName field', () => {
    const part = {
      type: 'dynamic-tool',
      toolName: 'whatever',
      state: 'input-available',
    } as UIMessage['parts'][number]

    expect(getToolPartName(part)).toBe('whatever')
    expect(isThinkingToolPart(part)).toBe(true)
  })

  it('returns an empty name for non-tool parts', () => {
    const parts: UIMessage['parts'] = [
      { type: 'text', text: 'Answer' },
      { type: 'reasoning', text: 'Thinking', state: 'done' },
      {
        type: 'source-url',
        sourceId: 'source-1',
        url: 'https://example.com',
      },
    ]

    for (const part of parts) {
      expect(getToolPartName(part)).toBe('')
      expect(isThinkingToolPart(part)).toBe(false)
    }
  })
})

describe('hasPendingToolPart', () => {
  it('returns false for an empty or undefined parts list', () => {
    expect(hasPendingToolPart(undefined)).toBe(false)
    expect(hasPendingToolPart([])).toBe(false)
  })

  it('treats input-streaming and input-available as pending', () => {
    expect(hasPendingToolPart([
      { type: 'tool-web_search', state: 'input-streaming' },
    ] as UIMessage['parts'])).toBe(true)

    expect(hasPendingToolPart([
      { type: 'tool-web_search', state: 'input-available' },
    ] as UIMessage['parts'])).toBe(true)
  })

  it('does not treat settled states as pending — allowlist regression guard', () => {
    const settledStates = [
      'output-available',
      'output-error',
      'output-denied',
      'approval-requested',
    ]

    for (const state of settledStates) {
      expect(hasPendingToolPart([
        { type: 'tool-web_search', state },
      ] as UIMessage['parts'])).toBe(false)
    }
  })

  it('treats a preliminary output-available as pending', () => {
    expect(hasPendingToolPart([
      { type: 'tool-web_search', state: 'output-available', preliminary: true },
    ] as UIMessage['parts'])).toBe(true)
  })

  it('never treats a pending generate_image part as pending', () => {
    expect(hasPendingToolPart([
      { type: 'tool-generate_image', state: 'input-available' },
    ] as UIMessage['parts'])).toBe(false)
  })

  it('treats a pending dynamic-tool part as pending', () => {
    expect(hasPendingToolPart([
      { type: 'dynamic-tool', toolName: 'search', state: 'input-available' },
    ] as UIMessage['parts'])).toBe(true)
  })
})

describe('isThinkingActive', () => {
  it('is true when reasoning alone is streaming', () => {
    expect(isThinkingActive([
      { type: 'reasoning', text: 'Thinking…', state: 'streaming' },
    ] as UIMessage['parts'])).toBe(true)
  })

  it('is true when reasoning is done but a tool call is pending', () => {
    expect(isThinkingActive([
      { type: 'reasoning', text: 'Thinking…', state: 'done' },
      { type: 'tool-web_search', state: 'input-available' },
    ] as UIMessage['parts'])).toBe(true)
  })

  it('is false when reasoning and the tool call are both done', () => {
    expect(isThinkingActive([
      { type: 'reasoning', text: 'Thinking…', state: 'done' },
      { type: 'tool-web_search', state: 'output-available' },
    ] as UIMessage['parts'])).toBe(false)
  })

  it('is false when only a pending generate_image part is present', () => {
    expect(isThinkingActive([
      { type: 'tool-generate_image', state: 'input-available' },
    ] as UIMessage['parts'])).toBe(false)
  })
})

describe('getToolStepTitle', () => {
  it('titles a known web_search_preview tool by pending state', () => {
    expect(getToolStepTitle('web_search_preview', true, false))
      .toBe('Searching the web')
    expect(getToolStepTitle('web_search_preview', false, false))
      .toBe('Searched the web')
  })

  it('titles a Moonshot-shaped dynamic search tool name without leaking symbols', () => {
    const title = getToolStepTitle('$web_search', true, false)

    expect(title).toBe('Searching the web')
    expect(title).not.toContain('$')
  })

  it('titles an arbitrary tool name with a humanized fallback', () => {
    expect(getToolStepTitle('my_custom_tool', true, false))
      .toBe('Using my custom tool')
    expect(getToolStepTitle('my_custom_tool', false, false))
      .toBe('Used my custom tool')
  })

  it('falls back to "a tool" for an empty name with no trailing space', () => {
    expect(getToolStepTitle('', true, false)).toBe('Using a tool')
  })

  it('titles a known web_search_preview tool as failed', () => {
    expect(getToolStepTitle('web_search_preview', false, true))
      .toBe('Search failed')
  })

  it('titles a generic search-matching tool as failed', () => {
    expect(getToolStepTitle('some_search_tool', false, true))
      .toBe('Search failed')
  })

  it('titles an arbitrary failed tool with a humanized, capitalized fallback', () => {
    expect(getToolStepTitle('my_custom_tool', false, true))
      .toBe('My custom tool failed')
  })

  it('falls back to "A tool failed" for an empty failed tool name', () => {
    expect(getToolStepTitle('', false, true)).toBe('A tool failed')
  })
})

describe('isFailedToolPart', () => {
  it('treats output-error and output-denied as failed', () => {
    expect(isFailedToolPart(
      { type: 'tool-web_search', state: 'output-error' } as
        UIMessage['parts'][number],
    )).toBe(true)
    expect(isFailedToolPart(
      { type: 'tool-web_search', state: 'output-denied' } as
        UIMessage['parts'][number],
    )).toBe(true)
  })

  it('does not treat pending, done, or approval states as failed', () => {
    const nonFailedStates = [
      'input-streaming',
      'input-available',
      'output-available',
      'approval-requested',
      'approval-responded',
    ]

    for (const state of nonFailedStates) {
      expect(isFailedToolPart(
        { type: 'tool-web_search', state } as UIMessage['parts'][number],
      )).toBe(false)
    }
  })

  it('never treats a failed generate_image part as failed', () => {
    expect(isFailedToolPart(
      { type: 'tool-generate_image', state: 'output-error' } as
        UIMessage['parts'][number],
    )).toBe(false)
  })
})
