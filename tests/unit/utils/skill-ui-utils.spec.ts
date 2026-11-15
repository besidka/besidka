import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../../../app/utils/relative-time'
import { buildSkillFileTreeRows } from '../../../app/utils/skill-file-tree'
import {
  describeFinding,
  describeFindingCounts,
  describeFindingSummary,
  describeHighlightCategories,
  describeHighlightTick,
  describeQuotedMention,
  describeSeverityCounts,
  groupFindingsBySeverity,
  groupFindingsByLine,
} from '../../../app/utils/skill-findings'
import type { SkillFinding } from '#shared/utils/skills/findings'
import {
  describeSkillVersionOrigin,
  findLocalEditsSinceImport,
  getSkillLicenseLabel,
} from '../../../app/utils/skill-labels'

describe('relative time', () => {
  const now = Date.parse('2026-11-14T12:00:00.000Z')

  it('reads minutes, hours, days and weeks', () => {
    expect(formatRelativeTime('2026-11-14T11:59:30.000Z', now)).toBe('just now')
    expect(formatRelativeTime('2026-11-14T11:50:00.000Z', now))
      .toBe('10 minutes ago')
    expect(formatRelativeTime('2026-11-14T10:00:00.000Z', now))
      .toBe('2 hours ago')
    expect(formatRelativeTime('2026-11-12T12:00:00.000Z', now))
      .toBe('2 days ago')
    expect(formatRelativeTime('2026-11-07T12:00:00.000Z', now))
      .toBe('last week')
  })

  it('returns an empty string for an invalid date', () => {
    expect(formatRelativeTime('nope', now)).toBe('')
  })
})

describe('skill file tree', () => {
  it('puts SKILL.md first and adds a row for every folder', () => {
    const rows = buildSkillFileTreeRows([
      { path: 'references/deep/a.md', bytes: 3 },
      { path: 'LICENSE.txt', bytes: 2 },
      { path: 'SKILL.md', bytes: 1 },
    ])

    expect(rows.map(row => `${row.type}:${row.path}:${row.depth}`)).toEqual([
      'file:SKILL.md:0',
      'file:LICENSE.txt:0',
      'directory:references:0',
      'directory:references/deep:1',
      'file:references/deep/a.md:2',
    ])
  })
})

describe('skill findings helpers', () => {
  it('writes a neutral tally with singular and plural nouns', () => {
    expect(describeFindingCounts({ url: 2, shell: 1 }))
      .toBe('2 links, 1 command')
    expect(describeFindingCounts({})).toBe('')
    expect(describeFindingCounts(null)).toBe('')
  })

  it('groups findings by severity in a fixed order and drops empty groups', () => {
    const make = (
      severity: SkillFinding['severity'],
      detail: string | null = null,
    ): SkillFinding => {
      return {
        type: 'url',
        rule: 'url',
        severity,
        path: 'a.md',
        line: 1,
        snippet: '',
        detail,
        source: 'rules',
      }
    }
    const groups = groupFindingsBySeverity([
      make('low'),
      make('high'),
      make('low'),
    ])

    expect(groups.map(group => `${group.title}:${group.findings.length}`))
      .toEqual(['Look closely:1', 'For your information:2'])
    expect(groups.map(group => group.isOpenByDefault)).toEqual([true, false])
    expect(describeQuotedMention(make('low', 'quoted, probably an example')))
      .toBe('(quoted, probably an example)')
    expect(describeQuotedMention(make('low', 'curl'))).toBe('')
  })

  it('tallies severities from stored counts', () => {
    const counts = {
      rulesVersion: 2,
      high: 1,
      low: 4,
      shell: 1,
      url: 4,
    }

    expect(describeSeverityCounts(counts))
      .toBe('1 to look closely at, 4 for your information')
    expect(describeFindingSummary(counts)).toBe(
      '1 to look closely at, 4 for your information (4 links, 1 command)',
    )
    expect(describeFindingSummary({ url: 2 })).toBe('2 links')
    expect(describeSeverityCounts({ url: 2 })).toBe('')
  })

  it('groups findings by line for one file', () => {
    const lines = groupFindingsByLine([
      { type: 'url', rule: 'url', severity: 'low', source: 'rules', path: 'a.md', line: 2, snippet: '', detail: null },
      { type: 'shell', rule: 'shell-curl', severity: 'low', source: 'rules', path: 'a.md', line: 2, snippet: '', detail: null },
      { type: 'url', rule: 'url', severity: 'low', source: 'rules', path: 'b.md', line: 2, snippet: '', detail: null },
    ], 'a.md')

    expect(lines.get(2)).toHaveLength(2)
    expect(lines.size).toBe(1)
  })
})

describe('skill labels', () => {
  it('names every license class', () => {
    expect(getSkillLicenseLabel('none')).toBe('No license stated')
    expect(getSkillLicenseLabel('authored')).toBe('Written by you')
  })

  it('describes where a version came from', () => {
    expect(describeSkillVersionOrigin({
      origin: 'editor',
      sourceKind: null,
      sourceVersion: null,
      isPending: false,
    })).toBe('Edited in Besidka')
    expect(describeSkillVersionOrigin({
      origin: 'import',
      sourceKind: 'github',
      sourceVersion: 'abcdef1234567',
      isPending: false,
    })).toBe('Imported @abcdef1')
    expect(describeSkillVersionOrigin({
      origin: 'import',
      sourceKind: 'zip',
      sourceVersion: 'sha256-abc',
      isPending: false,
    })).toBe('Imported')
    expect(describeSkillVersionOrigin({
      origin: 'mcp',
      sourceKind: 'mcp',
      sourceVersion: null,
      isPending: true,
    })).toBe('From a connected app, pending')
  })

  it('finds the local edits made since the last import or update', () => {
    expect(findLocalEditsSinceImport([
      { version: 6, origin: 'update', isPending: true },
      { version: 5, origin: 'restore', isPending: false },
      { version: 4, origin: 'editor', isPending: false },
      { version: 3, origin: 'update', isPending: false },
      { version: 2, origin: 'editor', isPending: false },
      { version: 1, origin: 'import', isPending: false },
    ])).toEqual([
      { version: 4, origin: 'editor' },
      { version: 5, origin: 'restore' },
    ])
  })

  it('finds no local edits for an untouched import', () => {
    expect(findLocalEditsSinceImport([
      { version: 2, origin: 'update', isPending: true },
      { version: 1, origin: 'import', isPending: false },
    ])).toEqual([])
  })
})

describe('highlight tick and finding text', () => {
  function makeFinding(overrides: Partial<SkillFinding>): SkillFinding {
    return {
      type: 'execution',
      rule: 'dynamic-context-inline',
      severity: 'high',
      path: 'SKILL.md',
      line: 4,
      snippet: 'x',
      detail: null,
      source: 'rules',
      ...overrides,
    }
  }

  it('names each Look closely kind once, in order', () => {
    expect(describeHighlightCategories([
      makeFinding({}),
      makeFinding({ type: 'concealment', rule: 'concealment' }),
      makeFinding({ line: 9 }),
      makeFinding({ type: 'url', rule: 'url', severity: 'low' }),
    ])).toBe('code that runs in Claude Code, a request to hide actions from you')
  })

  it('words the second tick with the count and the kinds', () => {
    const findings = [makeFinding({})]

    expect(describeHighlightTick(3, findings)).toBe(
      'I read the 3 highlights marked Look closely (code that runs in Claude Code)',
    )
    expect(describeHighlightTick(1, findings)).toBe(
      'I read the highlight marked Look closely (code that runs in Claude Code)',
    )
    expect(describeHighlightTick(2, [])).toBe(
      'I read the 2 highlights marked Look closely',
    )
  })

  it('gives no second tick for no highlight', () => {
    expect(describeHighlightTick(0, [])).toBe('')
  })

  it('keeps the quoted and catalog details out of the rule detail', () => {
    expect(describeFinding(makeFinding({
      detail: 'quoted, probably an example',
    })).detail).toBe('')
    expect(describeFinding(makeFinding({
      detail: 'sent with every message while the skill is on Auto',
    }))).toMatchObject({
      detail: '',
      callout: 'This text is in every message while the skill is on Auto.',
    })
    expect(describeFinding(makeFinding({
      type: 'exfiltration',
      rule: 'markdown-image-query',
      detail: 'sends text to evil.example',
    })).detail).toBe('sends text to evil.example')
  })

  it('falls back to the detail for a rule this build does not know', () => {
    expect(describeFinding(makeFinding({
      rule: 'a-rule-from-the-future',
      detail: 'something worth reading',
    }))).toMatchObject({
      explanation: 'something worth reading',
      detail: '',
    })
  })
})
