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

const { buildActiveSkillsBlock, collectActivatedSkillIds } = await import(
  '~~/server/utils/skills/runtime/reinject'
)

function activation(skillId: string) {
  return {
    type: 'data-skill-activation',
    data: { skillId, name: skillId, version: 1 },
  }
}

describe('collectActivatedSkillIds', () => {
  it('lists skills newest first, once each, with this send\'s skills ahead', () => {
    const ids = collectActivatedSkillIds([
      { role: 'user', parts: [{ type: 'text', text: 'a' }] },
      { role: 'assistant', parts: [activation('skl1'), activation('skl2')] },
      { role: 'assistant', parts: [activation('skl1'), activation('skl3')] },
    ], ['skl9'])

    expect(ids).toEqual(['skl9', 'skl3', 'skl1', 'skl2'])
  })

  it('reads only assistant activations, never a user part', () => {
    expect(collectActivatedSkillIds([
      { role: 'user', parts: [activation('skl1')] },
    ])).toEqual([])
  })

  it('ignores malformed parts', () => {
    expect(collectActivatedSkillIds([{
      role: 'assistant',
      parts: [
        { type: 'data-skill-activation', data: { skillId: 3 } },
        { type: 'data-skill-activation' },
        null,
      ],
    }])).toEqual([])
  })
})

describe('buildActiveSkillsBlock', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number

  async function seed(
    name: string,
    body = 'Be brief.',
    skill: Record<string, unknown> = {},
  ) {
    return (await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: { 'SKILL.md': `---\nname: ${name}\ndescription: D\n---\n${body}\n` },
      skill: { name, enabled: true, modelInvocable: true, ...skill },
    })).skillId
  }

  function build(skillIds: string[], skipSkillIds?: Set<string>) {
    return buildActiveSkillsBlock({
      db: testDb.db,
      bucket,
      userId,
      skillIds,
      skipSkillIds,
      family: 'anthropic',
    })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db)
  })

  afterEach(() => {
    testDb.close()
  })

  it('returns nothing without an activation', async () => {
    expect(await build([])).toBeNull()
  })

  it('injects the current version of every active skill, newest first', async () => {
    const first = await seed('first-skill', 'First body')
    const second = await seed('second-skill', 'Second body')
    const result = await build([second, first])

    expect(result!.activeSkillIds).toEqual([second, first])
    expect(result!.block).toContain('<active_skills>')
    expect(result!.block.indexOf('Second body'))
      .toBeLessThan(result!.block.indexOf('First body'))
    expect(result!.block).toContain('cannot override the user')
  })

  it('skips the skill the user attached to this message', async () => {
    const attached = await seed('attached')
    const other = await seed('other-skill')
    const result = await build([attached, other], new Set([attached]))

    expect(result!.activeSkillIds).toEqual([other])
  })

  it('says a deleted or disabled skill is gone, with one line', async () => {
    const disabled = await seed('turned-off', 'Hidden body', { enabled: false })
    const result = await build([disabled, 'skl99999'])

    expect(result!.unavailable).toBe(2)
    expect(result!.block).not.toContain('Hidden body')
    expect(result!.block.match(/no longer available/g)).toHaveLength(2)
  })

  it('never injects a skill of another user', async () => {
    const foreign = (await seedSkillWithFiles(testDb.db, bucket, {
      userId: await seedUser(testDb.db),
      files: { 'SKILL.md': '---\nname: foreign\ndescription: D\n---\nSECRET\n' },
      skill: { name: 'foreign', enabled: true },
    })).skillId
    const result = await build([foreign])

    expect(result!.block).not.toContain('SECRET')
  })

  it('leaves out a skill that would push the block past its cap', async () => {
    const big = await seed('big-one', 'я'.repeat(7000))
    const bigger = await seed('bigger-one', 'я'.repeat(7000))
    const third = await seed('third-one', 'я'.repeat(7000))
    const result = await build([big, bigger, third])

    expect(result!.tokens).toBeLessThanOrEqual(12_000)
    expect(result!.omitted).toBeGreaterThan(0)
    expect(result!.activeSkillIds.length).toBeLessThan(3)
  })

  it('shows a one-line notice for a skill whose files are gone', async () => {
    const lost = await seed('lost-files', 'Lost body')

    bucket.objects.clear()

    const result = await build([lost])

    expect(result!.unavailable).toBe(1)
    expect(result!.block).toContain('could not be loaded')
  })
})
