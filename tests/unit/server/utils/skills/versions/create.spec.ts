import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { SKILLS_PER_USER } from '#shared/utils/skills-policy'
import { BLANK_COMMAND_ARGUMENT_HINT } from '#shared/utils/skills/blank'
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
      command: null,
      argumentHint: null,
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
      modelInvocable: true,
      slashCommand: false,
      slashName: null,
      argumentHint: null,
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

  async function skillMarkdownOf(skillId: string) {
    const [file] = await testDb.db.select()
      .from(schema.skillFiles)
      .where(eq(schema.skillFiles.skillId, skillId))
    const object = bucket.objects.get(
      `user-skills/u${userId}/${skillId}/blobs/${file!.blobSha256}`,
    )

    return new TextDecoder().decode(object!.bytes)
  }

  it('creates a blank skill with a command that uses $ARGUMENTS', async () => {
    const created = await create({
      kind: 'blank',
      name: 'summarise',
      mode: 'ask',
      command: 'summarise',
      argumentHint: ' What to summarise ',
    })
    const row = await skillRow(created.id)

    expect(created).toMatchObject({
      modelInvocable: false,
      command: 'summarise',
      argumentHint: 'What to summarise',
      enabled: true,
    })
    expect(row).toMatchObject({
      modelInvocable: false,
      slashCommand: false,
      slashName: 'summarise',
      argumentHint: 'What to summarise',
      enabled: true,
    })
    expect(await skillMarkdownOf(created.id)).toContain('$ARGUMENTS')
  })

  it('uses the default argument hint when a command has none', async () => {
    const created = await create({
      kind: 'blank',
      name: 'summarise',
      command: 'summarise',
    })

    expect(created.argumentHint).toBe(BLANK_COMMAND_ARGUMENT_HINT)
  })

  it('keeps the skill body and no hint when there is no command', async () => {
    const created = await create({
      kind: 'blank',
      name: 'plain-skill',
      argumentHint: 'ignored',
    })
    const row = await skillRow(created.id)

    expect(row.argumentHint).toBeNull()
    expect(await skillMarkdownOf(created.id)).not.toContain('$ARGUMENTS')
  })

  it('drops one leading slash and trims the command', async () => {
    const created = await create({
      kind: 'blank',
      name: 'review',
      command: ' /review-pr ',
    })

    expect(created.command).toBe('review-pr')
    expect((await skillRow(created.id)).slashName).toBe('review-pr')
  })

  it('treats a blank command as no command', async () => {
    const created = await create({
      kind: 'blank',
      name: 'review',
      command: '  ',
    })

    expect(created.command).toBeNull()
    expect((await skillRow(created.id)).slashName).toBeNull()
  })

  it.each([
    ['off', { enabled: false, modelInvocable: false }],
    ['auto', { enabled: true, modelInvocable: true }],
    ['ask', { enabled: true, modelInvocable: false }],
  ] as const)('creates a blank skill in the %s mode', async (mode, expected) => {
    const created = await create({
      kind: 'blank',
      name: 'moded',
      mode,
    })

    expect(created.enabled).toBe(expected.enabled)
    expect(created.modelInvocable).toBe(expected.modelInvocable)
    expect(await skillRow(created.id)).toMatchObject(expected)
  })

  it('creates a skill from a template with its own mode and no command', async () => {
    const created = await create({
      kind: 'template',
      template: 'meeting-notes',
    })
    const row = await skillRow(created.id)

    expect(created).toMatchObject({
      name: 'meeting-notes',
      filesCount: 1,
      modelInvocable: false,
      command: null,
    })
    expect(row).toMatchObject({
      sourceKind: 'template',
      slashCommand: false,
      slashName: null,
      modelInvocable: false,
      argumentHint: null,
      licenseClass: 'authored',
      enabled: true,
    })

    const [version] = await testDb.db.select()
      .from(schema.skillVersions)
      .where(eq(schema.skillVersions.skillId, created.id))

    expect(version!.origin).toBe('template')
  })

  it('creates a template skill with the command the user chose', async () => {
    const created = await create({
      kind: 'template',
      template: 'meeting-notes',
      mode: 'auto',
      command: 'meeting-notes',
    })
    const row = await skillRow(created.id)

    expect(created).toMatchObject({
      modelInvocable: true,
      command: 'meeting-notes',
      argumentHint: 'Paste the raw notes',
    })
    expect(row).toMatchObject({
      slashName: 'meeting-notes',
      argumentHint: 'Paste the raw notes',
      modelInvocable: true,
    })
  })

  it('defaults a model-invocable template to Auto', async () => {
    const created = await create({
      kind: 'template',
      template: 'writing-style',
    })

    expect(created.modelInvocable).toBe(true)
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

  it('allows a reserved skill name', async () => {
    expect(await create({ kind: 'blank', name: 'memory' }))
      .toMatchObject({ name: 'memory', command: null, enabled: true })
  })

  it('refuses a reserved command with reserved-name', async () => {
    const failure = await failureOf(create({
      kind: 'blank',
      name: 'my-skill',
      command: 'memory',
    }))
    const rows = await testDb.db.select()
      .from(schema.skills)
      .where(eq(schema.skills.userId, userId))

    expect(failure).toMatchObject({ status: 400, code: 'reserved-name' })
    expect(rows).toEqual([])
  })

  it('refuses a command with an invalid pattern', async () => {
    expect(await failureOf(create({
      kind: 'blank',
      name: 'my-skill',
      command: 'Not Valid',
    }))).toMatchObject({ status: 400, code: 'reserved-name' })
    expect(await failureOf(create({
      kind: 'blank',
      name: 'my-skill',
      command: '/Foo',
    }))).toMatchObject({ status: 400, code: 'reserved-name' })
  })

  it('refuses a command another skill already has with command-taken', async () => {
    await create({ kind: 'blank', name: 'first', command: 'run-it' })

    const failure = await failureOf(create({
      kind: 'blank',
      name: 'second',
      command: 'run-it',
    }))
    const rows = await testDb.db.select()
      .from(schema.skills)
      .where(eq(schema.skills.userId, userId))

    expect(failure).toMatchObject({
      status: 409,
      code: 'command-taken',
      message: '/run-it is already a command',
    })
    expect(rows).toHaveLength(1)
  })

  it('allows the command of another user', async () => {
    const otherUserId = await seedUser(testDb.db)

    await createAuthoredSkill({
      db: testDb.db,
      bucket,
      userId: otherUserId,
      request: { kind: 'blank', name: 'theirs', command: 'run-it' },
      logger,
    })

    expect(await create({ kind: 'blank', name: 'mine', command: 'run-it' }))
      .toMatchObject({ command: 'run-it' })
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
