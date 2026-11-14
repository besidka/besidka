import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { SKILLS_PER_USER } from '#shared/utils/skills-policy'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  seedSkill,
} from '../../../../../setup/helpers/skills-db'
import type { FakeSkillBucket } from '../../../../../setup/helpers/skills-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const { createAuthoredSkill } = await import(
  '~~/server/utils/skills/versions/create'
)

const logger = { set: vi.fn() }

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string }
  }

  throw new Error('Expected a rejection')
}

describe('createAuthoredSkill', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number

  function create(
    request: Parameters<typeof createAuthoredSkill>[0]['request'],
  ) {
    return createAuthoredSkill({
      db: testDb.db,
      bucket,
      userId,
      request,
      logger,
    })
  }

  async function skillRow(skillId: string) {
    const [row] = await testDb.db.select()
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId))

    return row!
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db)
    logger.set.mockClear()
  })

  afterEach(() => {
    testDb.close()
  })

  it('creates a blank skill: authored, enabled, version 1', async () => {
    const created = await create({
      kind: 'blank',
      name: 'my-skill',
      description: 'Helps with my notes',
    })
    const row = await skillRow(created.id)

    expect(created).toMatchObject({
      name: 'my-skill',
      version: 1,
      enabled: true,
      status: 'ready',
      licenseClass: 'authored',
      filesCount: 1,
      modelInvocable: true,
      slashCommand: false,
    })
    expect(row).toMatchObject({
      name: 'my-skill',
      description: 'Helps with my notes',
      enabled: true,
      status: 'ready',
      licenseClass: 'authored',
      sourceKind: 'editor',
      createdVia: 'app',
      currentVersion: 1,
      pendingVersion: null,
      sourceVersion: null,
      allowScripts: false,
    })

    const [version] = await testDb.db.select()
      .from(schema.skillVersions)
      .where(eq(schema.skillVersions.skillId, created.id))
    const files = await testDb.db.select()
      .from(schema.skillFiles)
      .where(eq(schema.skillFiles.skillId, created.id))

    expect(version).toMatchObject({
      version: 1,
      origin: 'editor',
      licenseClass: 'authored',
    })
    expect(files.map((file) => {
      return file.path
    })).toEqual(['SKILL.md'])
    expect(bucket.objects.size).toBe(1)
  })

  it('creates a blank command that uses $ARGUMENTS', async () => {
    const created = await create({
      kind: 'command',
      name: 'summarise',
      argumentHint: ' What to summarise ',
    })
    const row = await skillRow(created.id)

    expect(created).toMatchObject({ modelInvocable: false, slashCommand: true })
    expect(row).toMatchObject({
      modelInvocable: false,
      slashCommand: true,
      argumentHint: 'What to summarise',
      enabled: true,
    })

    const [file] = await testDb.db.select()
      .from(schema.skillFiles)
      .where(eq(schema.skillFiles.skillId, created.id))
    const object = bucket.objects.get(
      `user-skills/u${userId}/${created.id}/blobs/${file!.blobSha256}`,
    )

    expect(new TextDecoder().decode(object!.bytes)).toContain('$ARGUMENTS')
  })

  it('creates a skill from a template with its own toggles', async () => {
    const created = await create({
      kind: 'template',
      template: 'meeting-notes',
    })
    const row = await skillRow(created.id)

    expect(created).toMatchObject({ name: 'meeting-notes', filesCount: 1 })
    expect(row).toMatchObject({
      sourceKind: 'template',
      slashCommand: true,
      modelInvocable: false,
      argumentHint: 'Paste the raw notes',
      licenseClass: 'authored',
      enabled: true,
    })

    const [version] = await testDb.db.select()
      .from(schema.skillVersions)
      .where(eq(schema.skillVersions.skillId, created.id))

    expect(version!.origin).toBe('template')
  })

  it('renames a template skill inside its SKILL.md', async () => {
    const created = await create({
      kind: 'template',
      template: 'writing-style',
      name: 'my-voice',
    })
    const [file] = await testDb.db.select()
      .from(schema.skillFiles)
      .where(and(
        eq(schema.skillFiles.skillId, created.id),
        eq(schema.skillFiles.path, 'SKILL.md'),
      ))
    const object = bucket.objects.get(
      `user-skills/u${userId}/${created.id}/blobs/${file!.blobSha256}`,
    )

    expect(created.name).toBe('my-voice')
    expect(new TextDecoder().decode(object!.bytes)).toContain('name: my-voice')
  })

  it('refuses a name that is taken and keeps no placeholder', async () => {
    await create({ kind: 'blank', name: 'taken' })

    const failure = await failureOf(create({ kind: 'blank', name: 'taken' }))
    const rows = await testDb.db.select()
      .from(schema.skills)
      .where(eq(schema.skills.userId, userId))

    expect(failure).toMatchObject({ status: 409, code: 'name-taken' })
    expect(rows).toHaveLength(1)
  })

  it('allows the name of another user', async () => {
    const otherUserId = await seedUser(testDb.db)

    await createAuthoredSkill({
      db: testDb.db,
      bucket,
      userId: otherUserId,
      request: { kind: 'blank', name: 'same-name' },
      logger,
    })

    expect(await create({ kind: 'blank', name: 'same-name' }))
      .toMatchObject({ name: 'same-name' })
  })

  it('refuses a reserved name for a command but not for a skill', async () => {
    expect(await failureOf(create({ kind: 'command', name: 'memory' })))
      .toMatchObject({ status: 400, code: 'reserved-name' })
    expect(await create({ kind: 'blank', name: 'memory' }))
      .toMatchObject({ name: 'memory', slashCommand: false })
  })

  it.each([
    ['an invalid name', { kind: 'blank', name: 'Not Valid' }, 'invalid-request'],
    ['an unknown template', { kind: 'template', template: 'nope' }, 'invalid-request'],
    ['an invalid template name', { kind: 'template', template: 'meeting-notes', name: 'A_B' }, 'invalid-request'],
  ] as const)('refuses %s', async (_label, request, code) => {
    const failure = await failureOf(create(request as never))

    expect(failure).toMatchObject({ status: 400, code })
  })

  it('stops at the limit of skills per user', async () => {
    for (let index = 0; index < SKILLS_PER_USER; index++) {
      await seedSkill(testDb.db, userId, { name: `seeded-${index}` })
    }

    expect(await failureOf(create({ kind: 'blank', name: 'one-more' })))
      .toMatchObject({ status: 403, code: 'skills-limit' })
  })

  it('removes the placeholder when the blob write fails', async () => {
    bucket.put.mockRejectedValueOnce(new Error('R2 down'))

    await expect(create({ kind: 'blank', name: 'half-made' }))
      .rejects.toThrow('R2 down')

    const rows = await testDb.db.select()
      .from(schema.skills)
      .where(eq(schema.skills.userId, userId))

    expect(rows).toEqual([])
  })

  it('logs counts only', async () => {
    await create({
      kind: 'blank',
      name: 'private-skill-name',
      description: 'private-description',
    })

    const logged = JSON.stringify(logger.set.mock.calls)

    expect(logged).toContain('"kind":"blank"')
    expect(logged).not.toContain('private-skill-name')
    expect(logged).not.toContain('private-description')
  })
})
