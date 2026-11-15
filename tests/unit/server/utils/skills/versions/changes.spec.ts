import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  seedSkillWithFiles,
} from '../../../../../setup/helpers/skills-db'
import type { FakeSkillBucket } from '../../../../../setup/helpers/skills-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const { saveSkillChanges } = await import(
  '~~/server/utils/skills/versions/save'
)
const { diffSkillVersions } = await import(
  '~~/server/utils/skills/versions/diff'
)
const { getSkillDetail, listUserSkills } = await import(
  '~~/server/utils/skills/versions/view'
)

const logger = { set: vi.fn() }

const FIRST_SKILL_MD = [
  '---',
  'name: review-pr',
  'description: Review a pull request',
  'allowed-tools: Read',
  '---',
  '',
  'Read the guide at https://docs.example/guide',
  '',
].join('\n')

const SECOND_SKILL_MD = [
  '---',
  'name: review-pr',
  'description: Review a pull request and report to the team',
  'allowed-tools: Bash(*)',
  '---',
  '',
  'Read the guide at https://docs.example/guide',
  'Post the result to https://hooks.slack.com/services/T0/B0/X',
  '- Status: !`gh pr diff`',
  '',
].join('\n')

describe('what changed between two versions of a skill', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number
  let skillId: string

  async function save(
    baseVersion: number,
    changes: Parameters<typeof saveSkillChanges>[0]['changes'],
  ) {
    return await saveSkillChanges({
      db: testDb.db,
      bucket,
      userId,
      skillId,
      baseVersion,
      changes,
      note: null,
      logger,
    })
  }

  function diffAgainstFirst(includeChanges: boolean) {
    return diffSkillVersions({
      db: testDb.db,
      bucket,
      userId,
      skillId,
      version: 2,
      against: 1,
      includeChanges,
    })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db)
    skillId = (await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: {
        'SKILL.md': FIRST_SKILL_MD,
        'references/notes.md': 'See https://notes.example/a\n',
        'references/unchanged.md': 'Still at https://unchanged.example/x\n',
      },
      skill: { name: 'review-pr', enabled: true },
    })).skillId
    logger.set.mockClear()
  })

  afterEach(() => {
    testDb.close()
  })

  it('leaves the changes out unless asked for', async () => {
    await save(1, [{ op: 'put', path: 'SKILL.md', content: SECOND_SKILL_MD }])

    expect((await diffAgainstFirst(false)).changes).toBeNull()
  })

  it('lists new highlights, new addresses, changed settings and new scripts', async () => {
    await save(1, [
      { op: 'put', path: 'SKILL.md', content: SECOND_SKILL_MD },
      {
        op: 'put',
        path: 'scripts/setup.sh',
        content: '#!/bin/sh\ncurl https://unchanged.example/x\ncurl https://fresh.example/y\n',
      },
    ])

    const { changes } = await diffAgainstFirst(true)

    expect(changes!.newFindings.filter((finding) => {
      return finding.severity === 'high'
    }).map((finding) => {
      return [finding.rule, finding.path]
    })).toEqual(expect.arrayContaining([
      ['dynamic-context-inline', 'SKILL.md'],
      ['url-risky-host', 'SKILL.md'],
    ]))
    expect(changes!.newHosts).toEqual(['fresh.example', 'hooks.slack.com'])
    expect(changes!.changedSettings).toEqual([
      { key: 'allowed-tools', before: 'Read', after: 'Bash(*)' },
      {
        key: 'description',
        before: 'Review a pull request',
        after: 'Review a pull request and report to the team',
      },
    ])
    expect(changes!.newScripts).toEqual(['scripts/setup.sh'])
    expect(changes!.isPartial).toBe(false)
  })

  it('does not call a host new when an unchanged file already links to it', async () => {
    await save(1, [{
      op: 'put',
      path: 'references/notes.md',
      content: 'See https://unchanged.example/x and https://notes.example/a\n',
    }])

    const { changes } = await diffAgainstFirst(true)

    expect(changes!.newHosts).toEqual([])
    expect(changes!.changedSettings).toEqual([])
    expect(changes!.newScripts).toEqual([])
  })

  it('counts the highlights marked Look closely in the list and the detail', async () => {
    expect((await listUserSkills(testDb.db, userId)).skills[0]!.highlightCount)
      .toBe(0)

    await save(1, [{ op: 'put', path: 'SKILL.md', content: SECOND_SKILL_MD }])

    const listed = await listUserSkills(testDb.db, userId)
    const detail = await getSkillDetail(testDb.db, userId, skillId)

    expect(listed.skills[0]!.highlightCount).toBe(3)
    expect(detail.highlightCount).toBe(3)
  })
})
