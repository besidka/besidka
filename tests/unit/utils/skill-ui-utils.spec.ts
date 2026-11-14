import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../../../app/utils/relative-time'
import { buildSkillFileTreeRows } from '../../../app/utils/skill-file-tree'
import {
  describeFindingCounts,
  groupFindingsByLine,
} from '../../../app/utils/skill-findings'
import {
  describeSkillVersionOrigin,
  findLocalEditsSinceImport,
  getSkillLicenceLabel,
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

  it('groups findings by line for one file', () => {
    const lines = groupFindingsByLine([
      { type: 'url', path: 'a.md', line: 2, snippet: '', detail: null },
      { type: 'shell', path: 'a.md', line: 2, snippet: '', detail: null },
      { type: 'url', path: 'b.md', line: 2, snippet: '', detail: null },
    ], 'a.md')

    expect(lines.get(2)).toHaveLength(2)
    expect(lines.size).toBe(1)
  })
})

describe('skill labels', () => {
  it('names every licence class', () => {
    expect(getSkillLicenceLabel('none')).toBe('No licence stated')
    expect(getSkillLicenceLabel('authored')).toBe('Written by you')
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
