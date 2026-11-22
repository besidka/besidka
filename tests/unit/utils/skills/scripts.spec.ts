import { describe, expect, it } from 'vitest'
import {
  SKILL_CONTAINER_MAX_SKILLS,
  buildProviderRenameNote,
  buildSkillScriptsApprovalSummary,
  containsProviderReservedWord,
  encodeProviderSkillVersion,
  hasSkillScripts,
  hashSkillScriptsSet,
  isProviderCopyCurrent,
  isProviderCopyLive,
  parseProviderSkillVersion,
  renameSkillMarkdown,
  toProviderSkillName,
} from '#shared/utils/skills/scripts'

const SKILL_MARKDOWN = [
  '---',
  'name: claude-api',
  'description: Calls the API',
  '---',
  '',
  '# Claude API',
  '',
  'Run scripts/run.py.',
  '',
].join('\n')

describe('toProviderSkillName', () => {
  it('leaves a name without a reserved word unchanged', () => {
    expect(toProviderSkillName('data-report')).toEqual({
      ok: true,
      providerName: 'data-report',
      isRenamed: false,
    })
  })

  it('treats the reserved words as a substring rule, not a prefix rule', () => {
    expect(toProviderSkillName('claude-api')).toEqual({
      ok: true,
      providerName: 'bsk-c-api',
      isRenamed: true,
    })
    expect(toProviderSkillName('my-claude-helper')).toMatchObject({
      ok: true,
      providerName: 'my-bsk-c-helper',
    })
    expect(toProviderSkillName('anthropic-tools')).toMatchObject({
      ok: true,
      providerName: 'bsk-a-tools',
    })
    expect(toProviderSkillName('myclaudehelper')).toMatchObject({
      ok: true,
      providerName: 'mybsk-chelper',
    })
  })

  it('replaces a word that reappears after a replacement', () => {
    const result = toProviderSkillName('cclaudelaude')

    expect(result).toMatchObject({ ok: true, isRenamed: true })

    if (result.ok) {
      expect(containsProviderReservedWord(result.providerName)).toBe(false)
    }
  })

  it('refuses a name that is not a valid skill name', () => {
    expect(toProviderSkillName('Claude API')).toEqual({
      ok: false,
      reason: 'invalid-name',
    })
    expect(toProviderSkillName('')).toEqual({
      ok: false,
      reason: 'invalid-name',
    })
  })

  it('matches the reserved words in any letter case', () => {
    expect(containsProviderReservedWord('My-CLAUDE')).toBe(true)
    expect(containsProviderReservedWord('plain-name')).toBe(false)
  })
})

describe('renameSkillMarkdown', () => {
  it('rewrites only the name line and adds the change note', () => {
    const renamed = renameSkillMarkdown(
      SKILL_MARKDOWN,
      'claude-api',
      'bsk-c-api',
    )

    expect(renamed).toContain('name: bsk-c-api')
    expect(renamed).toContain('description: Calls the API')
    expect(renamed).toContain('# Claude API')
    expect(renamed).toContain(buildProviderRenameNote('claude-api', 'bsk-c-api'))
    expect(renamed?.match(/^name:/gm)).toHaveLength(1)
  })

  it('handles a quoted name key and CRLF line endings', () => {
    const renamed = renameSkillMarkdown(
      '---\r\n"name": "claude-api"\r\ndescription: x\r\n---\r\nBody\r\n',
      'claude-api',
      'bsk-c-api',
    )

    expect(renamed).toContain('name: bsk-c-api')
    expect(renamed).not.toContain('"claude-api"\n')
  })

  it('fails closed when there is no frontmatter or no name line', () => {
    expect(renameSkillMarkdown('# Only a body', 'a', 'b')).toBeNull()
    expect(renameSkillMarkdown(
      '---\ndescription: x\n---\nBody',
      'a',
      'b',
    )).toBeNull()
  })
})

describe('provider skill version encoding', () => {
  it('round-trips both versions', () => {
    const encoded = encodeProviderSkillVersion({
      besidkaVersion: 3,
      providerVersion: '1759178010641129',
    })

    expect(encoded).toBe('3:1759178010641129')
    expect(parseProviderSkillVersion(encoded)).toEqual({
      besidkaVersion: 3,
      providerVersion: '1759178010641129',
    })
  })

  it('reads anything it did not write as unknown', () => {
    expect(parseProviderSkillVersion(null)).toBeNull()
    expect(parseProviderSkillVersion('')).toBeNull()
    expect(parseProviderSkillVersion('latest')).toBeNull()
    expect(parseProviderSkillVersion('3:')).toBeNull()
    expect(parseProviderSkillVersion('x:123')).toBeNull()
    expect(parseProviderSkillVersion('3:12 3')).toBeNull()
  })

  it('refuses to encode an empty provider version', () => {
    expect(() => {
      return encodeProviderSkillVersion({
        besidkaVersion: 1,
        providerVersion: '',
      })
    }).toThrow()
  })
})

describe('provider copy state', () => {
  const live = {
    providerSkillId: 'skill_01',
    providerSkillVersion: '2:1759178010641129',
    providerUploadedName: 'bsk-c-api',
    providerDeletedAt: null,
  }

  it('is live only with an id and no deletion stamp', () => {
    expect(isProviderCopyLive(live)).toBe(true)
    expect(isProviderCopyLive({ ...live, providerSkillId: null })).toBe(false)
    expect(isProviderCopyLive({
      ...live,
      providerDeletedAt: new Date(),
    })).toBe(false)
  })

  it('is current only for the Besidka version it was uploaded from', () => {
    expect(isProviderCopyCurrent(live, 2)).toBe(true)
    expect(isProviderCopyCurrent(live, 3)).toBe(false)
    expect(isProviderCopyCurrent({
      ...live,
      providerSkillVersion: 'latest',
    }, 2)).toBe(false)
  })
})

describe('hasSkillScripts', () => {
  it('needs a file of the script kind', () => {
    expect(hasSkillScripts([{ kind: 'skill-md' }, { kind: 'reference' }]))
      .toBe(false)
    expect(hasSkillScripts([{ kind: 'skill-md' }, { kind: 'script' }]))
      .toBe(true)
  })
})

describe('hashSkillScriptsSet', () => {
  it('does not depend on the order of the skills', async () => {
    const first = await hashSkillScriptsSet([
      { id: 'a', currentVersion: 1 },
      { id: 'b', currentVersion: 2 },
    ])
    const second = await hashSkillScriptsSet([
      { id: 'b', currentVersion: 2 },
      { id: 'a', currentVersion: 1 },
    ])

    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when a version changes or a skill joins', async () => {
    const base = await hashSkillScriptsSet([{ id: 'a', currentVersion: 1 }])

    expect(await hashSkillScriptsSet([{ id: 'a', currentVersion: 2 }]))
      .not.toBe(base)
    expect(await hashSkillScriptsSet([
      { id: 'a', currentVersion: 1 },
      { id: 'b', currentVersion: 1 },
    ])).not.toBe(base)
  })
})

describe('buildSkillScriptsApprovalSummary', () => {
  it('names the skills in the ticket wording', () => {
    expect(buildSkillScriptsApprovalSummary(['data-report'])).toBe(
      'Run scripts from data-report in Anthropic\'s container on your key?',
    )
  })

  it('lists no more skills than a request can carry', () => {
    const names = Array.from({ length: 12 }, (_value, index) => {
      return `skill-${index}`
    })
    const summary = buildSkillScriptsApprovalSummary(names)

    expect(summary).toContain(`skill-${SKILL_CONTAINER_MAX_SKILLS - 1}`)
    expect(summary).not.toContain(`skill-${SKILL_CONTAINER_MAX_SKILLS},`)
  })
})
