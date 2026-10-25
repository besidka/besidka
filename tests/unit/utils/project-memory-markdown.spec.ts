import { describe, expect, it } from 'vitest'
import type { MemoryEntryGroup } from '#shared/types/memory-api.d'
import {
  escapeMemoryMarkdown,
  formatProjectMemoryMarkdown,
} from '../../../app/utils/project-memory-markdown'

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    projectId: 'project-1',
    category: 'topics',
    slug: 'launch-plan',
    title: 'Launch plan',
    description: 'Ships in June',
    body: 'Ships in June.',
    sensitivity: 'none',
    sensitiveCategory: null,
    origin: 'extraction',
    sourceChatIds: [],
    sourceMessageId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt: null,
    ...overrides,
  }
}

function group(
  category: string,
  entries: Array<Record<string, unknown>>,
): MemoryEntryGroup {
  return { category, entries: entries.map(entry) } as MemoryEntryGroup
}

describe('escapeMemoryMarkdown', () => {
  it('keeps plain text and collapses whitespace to one line', () => {
    expect(escapeMemoryMarkdown('  Ships\n in\t June.  '))
      .toBe('Ships in June.')
  })

  it.each([
    ['backslash', 'a\\b', 'a\\\\b'],
    ['asterisk', '*bold*', '\\*bold\\*'],
    ['underscore', 'snake_case', 'snake\\_case'],
    ['backtick', '`code`', '\\`code\\`'],
    ['brackets', '[link](x)', '\\[link\\](x)'],
    ['angle brackets', '<b>x</b>', '\\<b\\>x\\</b\\>'],
    ['braces', 'x{.class}', 'x\\{.class\\}'],
  ])('escapes %s', (_label, input, expected) => {
    expect(escapeMemoryMarkdown(input)).toBe(expected)
  })

  it('escapes a colon that would start an MDC component only', () => {
    expect(escapeMemoryMarkdown('use :button here')).toBe('use \\:button here')
    expect(escapeMemoryMarkdown('Note: 5 items')).toBe('Note: 5 items')
    expect(escapeMemoryMarkdown('12:30 and https://x.test'))
      .toBe('12:30 and https://x.test')
  })

  it('escapes a heading, list or quote marker at the start', () => {
    expect(escapeMemoryMarkdown('# Title')).toBe('\\# Title')
    expect(escapeMemoryMarkdown('- item')).toBe('\\- item')
    expect(escapeMemoryMarkdown('> quote')).toBe('\\> quote')
    expect(escapeMemoryMarkdown('a # b - c')).toBe('a # b - c')
  })
})

describe('formatProjectMemoryMarkdown', () => {
  it('returns null without entries and legacy memory', () => {
    expect(formatProjectMemoryMarkdown([], null)).toBeNull()
    expect(formatProjectMemoryMarkdown([group('topics', [])], '  '))
      .toBeNull()
  })

  it('builds one bold heading and one bullet per entry per category', () => {
    const markdown = formatProjectMemoryMarkdown([
      group('topics', [
        entry(),
        entry({ title: 'Budget', body: 'Line one\nline two' }),
      ]),
      group('people', [entry({ title: 'Ana', body: 'Lead designer' })]),
    ], null)

    expect(markdown).toBe([
      '**Topics**',
      '- **Launch plan** — Ships in June.',
      '- **Budget** — Line one line two',
      '',
      '**People**',
      '- **Ana** — Lead designer',
    ].join('\n'))
  })

  it('skips categories without entries', () => {
    expect(formatProjectMemoryMarkdown([
      group('areas', []),
      group('people', [entry({ title: 'Ana', body: 'Lead' })]),
    ], null)).toBe('**People**\n- **Ana** — Lead')
  })

  it('escapes entry titles and bodies', () => {
    const markdown = formatProjectMemoryMarkdown([
      group('topics', [entry({ title: '*Hot*', body: '# :button <x>' })]),
    ], null)

    expect(markdown).toBe(
      '**Topics**\n- **\\*Hot\\*** — \\# \\:button \\<x\\>',
    )
  })

  it('returns the legacy text alone when there are no entries', () => {
    expect(formatProjectMemoryMarkdown([], '  Old *notes*.  '))
      .toBe('Old *notes*.')
  })

  it('adds the legacy text as a separate section below the entries', () => {
    const markdown = formatProjectMemoryMarkdown(
      [group('topics', [entry()])],
      'Old *notes*.',
    )

    expect(markdown).toBe([
      '**Topics**',
      '- **Launch plan** — Ships in June.',
      '',
      '**Earlier project memory (not converted yet)**',
      '',
      'Old *notes*.',
    ].join('\n'))
  })
})
