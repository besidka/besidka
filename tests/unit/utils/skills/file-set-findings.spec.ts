import { describe, expect, it } from 'vitest'
import { analyzeSkillFiles } from '#shared/utils/skills/analyze'
import { scanSkillFileSet } from '#shared/utils/skills/file-set-findings'
import type { SkillFinding } from '#shared/utils/skills/findings'

function files(entries: Record<string, string>) {
  return Object.entries(entries).map(([path, text]) => {
    return { path, text }
  })
}

function scan(
  entries: Record<string, string>,
  options: {
    name?: string
    source?: string | null
    otherSkillNames?: string[]
  } = {},
): SkillFinding[] {
  return scanSkillFileSet({
    files: files(entries),
    name: options.name ?? 'my-skill',
    source: options.source ?? null,
    otherSkillNames: options.otherSkillNames ?? [],
  })
}

function rulesOf(findings: SkillFinding[]): string[] {
  return findings.map((finding) => {
    return finding.rule
  })
}

const SKILL_MD = '---\nname: my-skill\ndescription: x\n---\nBody'

describe('scripts and hidden names', () => {
  it('notes each script file as low', () => {
    const findings = scan({
      'SKILL.md': `${SKILL_MD}\nRun scripts/run.sh and scripts/run.py`,
      'scripts/run.sh': 'echo',
      'scripts/run.py': 'print()',
      'scripts/run.ps1': '',
      'scripts/run.rb': '',
      'scripts/run.go': '',
      'scripts/run.js': '',
      'scripts/run.ts': '',
    }).filter((finding) => {
      return finding.rule === 'script-file'
    })

    expect(findings).toHaveLength(7)
    expect(findings[0]).toMatchObject({
      type: 'file',
      severity: 'low',
      path: 'scripts/run.sh',
      detail: '.sh script',
    })
  })

  it('does not note a document or a data file as a script', () => {
    expect(rulesOf(scan({
      'SKILL.md': `${SKILL_MD}\nSee references/a.md and data.json`,
      'references/a.md': 'a',
      'data.json': '{}',
    }))).not.toContain('script-file')
  })

  it('flags a hidden file or folder name', () => {
    const findings = scan({
      'SKILL.md': `${SKILL_MD}\nSee .notes.md and .config/a.json`,
      '.notes.md': 'a',
      '.config/a.json': '{}',
      'visible.md': 'b',
    }).filter((finding) => {
      return finding.rule === 'dotfile-path'
    })

    expect(findings.map((finding) => {
      return finding.path
    })).toEqual(['.notes.md', '.config/a.json'])
    expect(findings[0]).toMatchObject({ type: 'file', severity: 'low' })
  })
})

describe('files that SKILL.md does not mention', () => {
  it('flags a file nothing mentions and leaves a mentioned one alone', () => {
    const findings = scan({
      'SKILL.md': `${SKILL_MD}\nRead references/guide.md first.`,
      'references/guide.md': 'a',
      'references/extra.md': 'b',
    }).filter((finding) => {
      return finding.rule === 'unreferenced-file'
    })

    expect(findings.map((finding) => {
      return finding.path
    })).toEqual(['references/extra.md'])
    expect(findings[0]).toMatchObject({ type: 'file', severity: 'low' })
  })

  it('counts a mention of the folder or a different case as a mention', () => {
    expect(rulesOf(scan({
      'SKILL.md': `${SKILL_MD}\nEverything is in the references folder: references/ and READ.md`,
      'references/a.md': 'a',
      'references/deep/b.md': 'b',
      'read.md': 'c',
    }))).not.toContain('unreferenced-file')
  })

  it('does not ask for a license file to be mentioned', () => {
    expect(rulesOf(scan({
      'SKILL.md': SKILL_MD,
      'LICENSE.txt': 'MIT',
    }))).not.toContain('unreferenced-file')
  })
})

describe('files that SKILL.md refers to but the skill does not hold', () => {
  it('flags a missing context.docx in a link or in backticks', () => {
    const findings = scan({
      'SKILL.md': `${SKILL_MD}\nLoad \`context.docx\` and [spec](references/spec.md).`,
      'references/other.md': 'x',
    }).filter((finding) => {
      return finding.rule === 'missing-reference'
    })

    expect(findings.map((finding) => {
      return finding.snippet
    })).toEqual(['references/spec.md', 'context.docx'])
    expect(findings[0]).toMatchObject({
      type: 'file',
      severity: 'low',
      path: 'SKILL.md',
      line: 6,
      detail: 'not in the skill',
    })
  })

  it('does not flag a reference that exists, a URL or an anchor', () => {
    expect(rulesOf(scan({
      'SKILL.md': `${SKILL_MD}\nSee [a](references/a.md), [b](https://x.example/b.md), [c](#top), \`./references/a.md\`, \`a.md\`.`,
      'references/a.md': 'a',
    }))).not.toContain('missing-reference')
  })

  it('does not flag code identifiers, images or glob patterns', () => {
    expect(rulesOf(scan({
      'SKILL.md': `${SKILL_MD}\nUse \`WidthType.DXA\` and \`logo.png\` and \`*.md\` and \`~/x.md\`.`,
    }))).not.toContain('missing-reference')
  })
})

describe('names that look like well-known ones', () => {
  it('flags a name one or two edits from a known skill as low', () => {
    const findings = scan(
      { 'SKILL.md': '---\nname: pdg\ndescription: x\n---\nBody' },
      { name: 'pdg' },
    ).filter((finding) => {
      return finding.rule === 'name-lookalike'
    })

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      type: 'frontmatter',
      severity: 'low',
      path: 'SKILL.md',
      line: 2,
      detail: 'close to the well-known skill "pdf"',
    })
  })

  it('says nothing for an exact known name or an unrelated one', () => {
    expect(rulesOf(scan({ 'SKILL.md': SKILL_MD }, { name: 'pdf' })))
      .not.toContain('name-lookalike')
    expect(rulesOf(scan({ 'SKILL.md': SKILL_MD }, { name: 'meeting-minutes' })))
      .not.toContain('name-lookalike')
  })

  it('is suppressed when the source is exactly anthropics/skills', () => {
    expect(rulesOf(scan({ 'SKILL.md': SKILL_MD }, {
      name: 'pdg',
      source: 'anthropics/skills',
    }))).not.toContain('name-lookalike')
    expect(rulesOf(scan({ 'SKILL.md': SKILL_MD }, {
      name: 'pdg',
      source: 'someone/skills',
    }))).toContain('name-lookalike')
  })

  it('compares with the account other skills when the server passes them', () => {
    expect(rulesOf(scan({ 'SKILL.md': SKILL_MD }, {
      name: 'release-notez',
      otherSkillNames: ['release-notes'],
    }))).toContain('name-lookalike')
    expect(rulesOf(scan({ 'SKILL.md': SKILL_MD }, {
      name: 'release-notez',
    }))).not.toContain('name-lookalike')
    expect(rulesOf(scan({ 'SKILL.md': SKILL_MD }, {
      name: 'release-notes',
      otherSkillNames: ['release-notes'],
    }))).not.toContain('name-lookalike')
  })

  it('compares with the Besidka template ids', () => {
    expect(rulesOf(scan({ 'SKILL.md': SKILL_MD }, { name: 'writing-styles' })))
      .toContain('name-lookalike')
  })

  it('flags a GitHub owner close to a well-known owner', () => {
    const findings = scan({ 'SKILL.md': SKILL_MD }, {
      source: 'anthropic/skills',
    }).filter((finding) => {
      return finding.rule === 'owner-lookalike'
    })

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      type: 'frontmatter',
      severity: 'low',
      detail: 'close to the well-known owner "anthropics"',
    })
  })

  it('says nothing for the real owner or an unrelated one', () => {
    expect(rulesOf(scan({ 'SKILL.md': SKILL_MD }, {
      source: 'anthropics/skills',
    }))).not.toContain('owner-lookalike')
    expect(rulesOf(scan({ 'SKILL.md': SKILL_MD }, {
      source: 'some-person/skills',
    }))).not.toContain('owner-lookalike')
    expect(rulesOf(scan({ 'SKILL.md': SKILL_MD }))).not.toContain(
      'owner-lookalike',
    )
  })
})

describe('cost at the file and size caps', () => {
  it('scans 200 deeply nested files against a 256 KiB SKILL.md quickly', () => {
    const skillMd = `${SKILL_MD}\n${'See references/a/b/c/d/file-1.md and `x.md`. '.repeat(5000)}`.slice(
      0,
      256 * 1024,
    )
    const entries: Record<string, string> = { 'SKILL.md': skillMd }

    for (let index = 0; index < 199; index++) {
      entries[`folder-${index % 40}/sub-${index % 7}/deep/file-${index}.md`] = 'x'
    }

    const started = performance.now()

    scan(entries)

    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe('analyzeSkillFiles', () => {
  const encoder = new TextEncoder()

  function inputFile(path: string, text: string) {
    return { path, bytes: encoder.encode(text), text }
  }

  it('adds the file-set findings to the findings and the counts', async () => {
    const result = await analyzeSkillFiles({
      files: [
        inputFile('SKILL.md', '---\nname: pdg\ndescription: x\n---\nBody'),
        inputFile('scripts/run.sh', 'echo'),
      ],
      folderName: null,
      source: 'anthropic/skills',
    })

    expect(result.ok && result.findings.map((finding) => {
      return finding.rule
    }).sort()).toEqual([
      'name-lookalike',
      'owner-lookalike',
      'script-file',
      'unreferenced-file',
    ])
    expect(result.ok && result.findingCounts).toMatchObject({
      low: 4,
      file: 2,
      frontmatter: 2,
    })
  })

  it('does not run the lookalike checks without a source or account names', async () => {
    const result = await analyzeSkillFiles({
      files: [inputFile('SKILL.md', '---\nname: pdf\ndescription: x\n---\nB')],
      folderName: null,
    })

    expect(result.ok && result.findings).toEqual([])
  })

  it('counts the frontmatter highlights of SKILL.md', async () => {
    const result = await analyzeSkillFiles({
      files: [inputFile(
        'SKILL.md',
        '---\nname: a-skill\ndescription: x\nhooks:\n  Stop: y\n---\nBody',
      )],
      folderName: null,
    })

    expect(result.ok && result.findingCounts).toMatchObject({
      high: 1,
      frontmatter: 1,
    })
  })
})
