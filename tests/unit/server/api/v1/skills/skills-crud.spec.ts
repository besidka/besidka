import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { extractSkillArchive } from '#shared/utils/skills/archive'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  createFakeSkillKv,
  seedSkill,
  seedSkillWithFiles,
} from '../../../../../setup/helpers/skills-db'
import type {
  FakeSkillBucket,
  FakeSkillKv,
} from '../../../../../setup/helpers/skills-db'
import {
  createSkillsRouteEvent,
  stubSkillsRouteGlobals,
} from '../../../../../setup/helpers/skills-route'
import type { SkillsRouteEvent } from '../../../../../setup/helpers/skills-route'
import { skillMarkdown } from '../../../../../setup/helpers/skill-archives'

const mocks = vi.hoisted(() => ({
  featureOn: true,
  env: {} as Record<string, unknown>,
  logger: { set: vi.fn() },
}))

vi.mock('cloudflare:workers', () => ({ env: mocks.env }))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

vi.mock('nuxt/server', async () => {
  const { skillsNuxtServerMockFactory } = await import(
    '../../../../../setup/helpers/skills-route'
  )

  return await skillsNuxtServerMockFactory()
})

vi.mock('~~/server/utils/features/guards', () => ({
  requireFeature: async (_event: unknown, flag: string) => {
    if (!mocks.featureOn || flag !== 'skills') {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }

    return { active: true }
  },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

const ROUTES = {
  list: '~~/server/api/v1/skills/index.get',
  create: '~~/server/api/v1/skills/index.post',
  detail: '~~/server/api/v1/skills/[id]/index.get',
  patch: '~~/server/api/v1/skills/[id]/index.patch',
  remove: '~~/server/api/v1/skills/[id]/index.delete',
  versions: '~~/server/api/v1/skills/[id]/versions/index.get',
  save: '~~/server/api/v1/skills/[id]/versions/index.post',
  diff: '~~/server/api/v1/skills/[id]/versions/[v]/diff.get',
  restore: '~~/server/api/v1/skills/[id]/versions/[v]/restore.post',
  files: '~~/server/api/v1/skills/[id]/files.get',
  download: '~~/server/api/v1/skills/[id]/download.get',
} as const

type RouteName = keyof typeof ROUTES

async function importHandler(name: RouteName) {
  const { default: handler } = await import(ROUTES[name])

  return handler as (input: unknown) => Promise<any>
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string }
  }

  throw new Error('Expected a rejection')
}

describe('skills create, save, restore and read routes', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeSkillKv
  let bucket: FakeSkillBucket
  let userId: number
  let skillId: string

  async function call(
    name: RouteName,
    partial: Partial<SkillsRouteEvent> = {},
  ) {
    const handler = await importHandler(name)
    const event = createSkillsRouteEvent({
      params: { id: skillId, v: '1' },
      ...partial,
    })
    const result = await handler(event)

    return { result, event }
  }

  beforeEach(async () => {
    mocks.featureOn = true
    delete mocks.env.SKILLS_RATE_LIMITER
    mocks.logger.set.mockClear()
    testDb = createMemoryExtractionTestDb()
    kv = createFakeSkillKv()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db, null)
    stubSkillsRouteGlobals({ userId, db: testDb.db, kv, bucket })
    skillId = (await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: {
        'SKILL.md': skillMarkdown(),
        'references/notes.md': 'First\n',
      },
      skill: { name: 'review-pr', enabled: true },
    })).skillId
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe.each([
    ['list', {}],
    ['create', { body: { kind: 'blank', name: 'new-one' } }],
    ['detail', {}],
    ['patch', { body: { mode: 'off' } }],
    ['remove', {}],
    ['versions', {}],
    ['save', {
      body: {
        baseVersion: 1,
        changes: [{ op: 'put', path: 'a.md', content: 'x' }],
      },
    }],
    ['diff', { params: { id: 'PLACEHOLDER', v: '1' } }],
    ['restore', { params: { id: 'PLACEHOLDER', v: '1' }, body: {} }],
    ['files', {}],
    ['download', {}],
  ] as Array<[RouteName, Partial<SkillsRouteEvent>]>)('%s', (name, partial) => {
    function resolved(): Partial<SkillsRouteEvent> {
      return partial.params
        ? { ...partial, params: { id: skillId, v: partial.params.v! } }
        : partial
    }

    it('answers 401 without a session', async () => {
      stubSkillsRouteGlobals({ userId: 0, db: testDb.db, kv, bucket })

      expect((await failureOf(call(name, resolved()))).status).toBe(401)
    })

    it('answers 404 when the skills flag is off', async () => {
      mocks.featureOn = false

      expect((await failureOf(call(name, resolved()))).status).toBe(404)
      expect(await testDb.db.select({ id: schema.skills.id })
        .from(schema.skills)).toHaveLength(1)
    })
  })

  describe.each([
    'detail',
    'patch',
    'remove',
    'versions',
    'save',
    'diff',
    'restore',
    'files',
    'download',
  ] as RouteName[])('%s with a bad skill id', (name) => {
    const bodies: Partial<Record<RouteName, unknown>> = {
      patch: { mode: 'off' },
      save: {
        baseVersion: 1,
        changes: [{ op: 'put', path: 'a.md', content: 'x' }],
      },
      restore: {},
    }

    it.each(['../x', 'skl424242', 'a b', '%'])('answers 404 for %j', async (id) => {
      const failure = await failureOf(
        call(name, { params: { id, v: '1' }, body: bodies[name] }),
      )

      expect(failure.status).toBe(404)
    })

    it('answers 404 for a skill of another user', async () => {
      stubSkillsRouteGlobals({
        userId: await seedUser(testDb.db, null),
        db: testDb.db,
        kv,
        bucket,
      })

      expect((await failureOf(
        call(name, { params: { id: skillId, v: '1' }, body: bodies[name] }),
      )).status).toBe(404)
    })
  })

  describe('GET /skills', () => {
    it('lists the skills with counts', async () => {
      const { result } = await call('list')

      expect(result.skills).toHaveLength(1)
      expect(result.counts.sources).toEqual({
        all: 1,
        created: 1,
        imported: 0,
        apps: 0,
      })
    })
  })

  describe('POST /skills', () => {
    it('creates a skill and answers 201', async () => {
      const { result, event } = await call('create', {
        body: { kind: 'template', template: 'meeting-notes' },
      })

      expect(event.status).toBe(201)
      expect(result).toMatchObject({
        name: 'meeting-notes',
        enabled: true,
        licenseClass: 'authored',
      })
    })

    it.each([
      ['an unknown kind', { kind: 'other', name: 'a' }],
      ['a missing name', { kind: 'blank' }],
      ['an unknown key', { kind: 'blank', name: 'a', enabled: false }],
      ['a hint with a control character', {
        kind: 'blank',
        name: 'a',
        argumentHint: 'bad\u0007',
      }],
      ['the removed command kind', { kind: 'command', name: 'a' }],
      ['an unknown mode', { kind: 'blank', name: 'a', mode: 'manual' }],
      ['a template that does not exist', { kind: 'template', template: 'x' }],
    ])('answers 400 for %s', async (_label, body) => {
      expect((await failureOf(call('create', { body }))).status).toBe(400)
    })

    it('answers 409 for a taken name', async () => {
      expect((await failureOf(call('create', {
        body: { kind: 'blank', name: 'review-pr' },
      }))).status).toBe(409)
    })

    it('creates a skill with a mode and a command', async () => {
      const { result, event } = await call('create', {
        body: {
          kind: 'blank',
          name: 'new-one',
          mode: 'ask',
          command: '/new-one',
        },
      })

      expect(event.status).toBe(201)
      expect(result).toMatchObject({
        name: 'new-one',
        enabled: true,
        modelInvocable: false,
        command: 'new-one',
      })
    })

    it('answers 400 reserved-name for a reserved command', async () => {
      const failure = await failureOf(call('create', {
        body: { kind: 'blank', name: 'new-one', command: 'memory' },
      }))

      expect(failure).toMatchObject({ status: 400, code: 'reserved-name' })
    })

    it('allows a reserved skill name', async () => {
      const { result, event } = await call('create', {
        body: { kind: 'blank', name: 'memory' },
      })

      expect(event.status).toBe(201)
      expect(result).toMatchObject({ name: 'memory', command: null })
    })

    it('answers 409 command-taken for a command in use', async () => {
      await testDb.db.update(schema.skills)
        .set({ slashName: 'taken-cmd' })
        .where(eq(schema.skills.id, skillId))

      const failure = await failureOf(call('create', {
        body: { kind: 'blank', name: 'new-one', command: 'taken-cmd' },
      }))

      expect(failure).toMatchObject({ status: 409, code: 'command-taken' })
    })

    it('refuses a body without a length and one over the cap', async () => {
      const body = { kind: 'blank', name: 'new-one' }

      expect((await failureOf(
        call('create', { body, headers: { 'content-length': '' } }),
      )).status).toBe(411)
      expect((await failureOf(
        call('create', { body, headers: { 'content-length': '9000' } }),
      )).status).toBe(413)
    })

    it('fails closed with 429 when the save counter cannot be written', async () => {
      kv.put.mockImplementation(async () => {
        throw new Error('KV down')
      })

      const failure = await failureOf(call('create', {
        body: { kind: 'blank', name: 'new-one' },
      }))

      expect(failure.status).toBe(429)
      expect(await testDb.db.select({ id: schema.skills.id })
        .from(schema.skills)).toHaveLength(1)
    })
  })

  describe('PATCH /skills/[id]', () => {
    it('changes settings only', async () => {
      const { result } = await call('patch', {
        body: {
          mode: 'ask',
          argumentHint: '  Pull request link ',
        },
      })

      expect(result).toMatchObject({
        enabled: true,
        modelInvocable: false,
        slashCommand: false,
        command: null,
        argumentHint: 'Pull request link',
        currentVersion: 1,
      })
    })

    it('sets and clears the command without touching the mode', async () => {
      await testDb.db.update(schema.skills)
        .set({ modelInvocable: true })
        .where(eq(schema.skills.id, skillId))

      const { result: withCommand } = await call('patch', {
        body: { command: '/review-pr' },
      })

      expect(withCommand).toMatchObject({
        command: 'review-pr',
        slashCommand: true,
        enabled: true,
        modelInvocable: true,
      })

      const { result: cleared } = await call('patch', {
        body: { command: null },
      })

      expect(cleared).toMatchObject({
        command: null,
        slashCommand: false,
        enabled: true,
        modelInvocable: true,
      })
    })

    it('answers 400 reserved-name for a reserved command', async () => {
      expect(await failureOf(call('patch', { body: { command: 'help' } })))
        .toMatchObject({ status: 400, code: 'reserved-name' })
    })

    it('answers 409 command-taken for another skill\'s command', async () => {
      await seedSkill(testDb.db, userId, {
        name: 'other-skill',
        slashName: 'shared-cmd',
      })

      expect(await failureOf(call('patch', {
        body: { command: 'shared-cmd' },
      }))).toMatchObject({ status: 409, code: 'command-taken' })
    })

    it('refuses content fields, an empty body and the old separate flags', async () => {
      const [before] = await testDb.db.select()
        .from(schema.skills)
        .where(eq(schema.skills.id, skillId))

      expect((await failureOf(call('patch', {
        body: { name: 'other-name' },
      }))).status).toBe(400)
      expect((await failureOf(call('patch', { body: {} }))).status).toBe(400)

      for (const body of [
        { enabled: false },
        { modelInvocable: true },
        { slashCommand: true },
        { mode: 'auto', slashCommand: false },
        { command: 5 },
      ]) {
        expect((await failureOf(call('patch', { body }))).status).toBe(400)
      }

      const [after] = await testDb.db.select()
        .from(schema.skills)
        .where(eq(schema.skills.id, skillId))

      expect(after).toEqual(before)
    })

    it('leaves a reserved skill name alone when the mode changes', async () => {
      await testDb.db.update(schema.skills)
        .set({ name: 'memory' })
        .where(eq(schema.skills.id, skillId))

      const { result } = await call('patch', { body: { mode: 'auto' } })

      expect(result).toMatchObject({
        name: 'memory',
        enabled: true,
        modelInvocable: true,
        command: null,
        slashCommand: false,
      })
    })
  })

  describe('POST /skills/[id]/versions', () => {
    const putChange = { op: 'put', path: 'references/notes.md', content: 'Two\n' }

    it('saves the next version', async () => {
      const { result } = await call('save', {
        body: { baseVersion: 1, changes: [putChange], note: ' Edited ' },
      })

      expect(result).toMatchObject({ unchanged: false, version: 2 })

      const [version] = await testDb.db.select()
        .from(schema.skillVersions)
        .where(eq(schema.skillVersions.version, 2))

      expect(version!.note).toBe('Edited')
    })

    it('answers 409 for a stale base', async () => {
      await call('save', { body: { baseVersion: 1, changes: [putChange] } })

      expect(await failureOf(call('save', {
        body: {
          baseVersion: 1,
          changes: [{ ...putChange, content: 'Three\n' }],
        },
      }))).toMatchObject({ status: 409, code: 'stale-base' })
    })

    it.each([
      ['no changes', { baseVersion: 1, changes: [] }],
      ['an unknown op', { baseVersion: 1, changes: [{ op: 'copy', path: 'a' }] }],
      ['a put without content', {
        baseVersion: 1,
        changes: [{ op: 'put', path: 'a.md' }],
      }],
      ['a base of zero', { baseVersion: 0, changes: [putChange] }],
      ['an unknown key', { baseVersion: 1, changes: [putChange], extra: 1 }],
      ['a note over 200 characters', {
        baseVersion: 1,
        changes: [putChange],
        note: 'n'.repeat(201),
      }],
      ['more than 50 changes', {
        baseVersion: 1,
        changes: Array.from({ length: 51 }, (_unused, index) => {
          return { op: 'put', path: `f${index}.md`, content: 'x' }
        }),
      }],
    ])('answers 400 for %s', async (_label, body) => {
      expect((await failureOf(call('save', { body }))).status).toBe(400)
    })

    it('allows a body over 2 MiB of JSON and refuses one over 4 MiB', async () => {
      const body = { baseVersion: 1, changes: [putChange] }

      await expect(call('save', {
        body,
        headers: { 'content-length': String(3 * 1024 * 1024) },
      })).resolves.toBeDefined()
      expect((await failureOf(call('save', {
        body: { baseVersion: 2, changes: [putChange] },
        headers: { 'content-length': String(4 * 1024 * 1024 + 1) },
      }))).status).toBe(413)
    })

    it('answers 429 with the save limit before any work', async () => {
      kv.put.mockImplementation(async () => {
        throw new Error('KV down')
      })

      expect((await failureOf(call('save', {
        body: { baseVersion: 1, changes: [putChange] },
      }))).status).toBe(429)
      expect(await testDb.db.select({ id: schema.skillVersions.id })
        .from(schema.skillVersions)).toHaveLength(1)
    })

    it('puts only ids and counts in the log', async () => {
      await call('save', {
        body: {
          baseVersion: 1,
          changes: [{ ...putChange, content: 'CONTENT-MARKER' }],
          note: 'NOTE-MARKER',
        },
      })

      const logged = JSON.stringify(mocks.logger.set.mock.calls)

      expect(logged).not.toContain('CONTENT-MARKER')
      expect(logged).not.toContain('NOTE-MARKER')
      expect(logged).not.toContain('notes.md')
    })
  })

  describe('versions, diff and restore', () => {
    beforeEach(async () => {
      await call('save', {
        body: {
          baseVersion: 1,
          changes: [
            { op: 'put', path: 'references/notes.md', content: 'Second\n' },
          ],
        },
      })
    })

    it('lists the versions', async () => {
      const { result } = await call('versions')

      expect(result).toMatchObject({ current: 2, pending: null })
      expect(result.versions.map((version: { version: number }) => {
        return version.version
      })).toEqual([2, 1])
    })

    it('diffs a version against the current one', async () => {
      const { result } = await call('diff', {
        params: { id: skillId, v: '1' },
        query: { against: '2' },
      })

      expect(result.diff.files).toHaveLength(1)
      expect(result.diff.files[0]).toMatchObject({
        path: 'references/notes.md',
        status: 'modified',
      })
    })

    it('answers 404 for a version that is not a number', async () => {
      expect((await failureOf(call('diff', {
        params: { id: skillId, v: 'abc' },
      }))).status).toBe(404)
      expect((await failureOf(call('diff', {
        params: { id: skillId, v: '9' },
      }))).status).toBe(404)
      expect((await failureOf(call('diff', {
        params: { id: skillId, v: '1' },
        query: { against: 'x' },
      }))).status).toBe(400)
    })

    it('restores an older version as a new one', async () => {
      const { result } = await call('restore', {
        params: { id: skillId, v: '1' },
        body: { baseVersion: 2 },
      })

      expect(result).toMatchObject({ version: 3, restoredFrom: 1 })
    })

    it('refuses a stale restore and a restore of the current version', async () => {
      expect(await failureOf(call('restore', {
        params: { id: skillId, v: '1' },
        body: { baseVersion: 1 },
      }))).toMatchObject({ status: 409, code: 'stale-base' })
      expect(await failureOf(call('restore', {
        params: { id: skillId, v: '2' },
        body: {},
      }))).toMatchObject({ status: 409, code: 'version-is-current' })
    })
  })

  describe('GET files and download', () => {
    it('lists files and reads one', async () => {
      const list = await call('files')
      const one = await call('files', {
        query: { path: 'references/notes.md', version: '1' },
      })

      expect(list.result.files).toHaveLength(2)
      expect(one.result).toMatchObject({ text: 'First\n', version: 1 })
    })

    it('refuses a bad query', async () => {
      expect((await failureOf(call('files', {
        query: { version: '0' },
      }))).status).toBe(400)
    })

    it('downloads a zip that imports back', async () => {
      const { result } = await call('download')

      expect(result).toBeInstanceOf(Response)
      expect((result as Response).headers.get('Content-Type'))
        .toBe('application/zip')
      expect((result as Response).headers.get('Cache-Control'))
        .toBe('private, no-store')
      expect((result as Response).headers.get('Content-Disposition'))
        .toBe('attachment; filename="review-pr.zip"')

      const bytes = new Uint8Array(await (result as Response).arrayBuffer())
      const extracted = extractSkillArchive(bytes)

      expect(extracted.ok).toBe(true)

      if (extracted.ok) {
        expect(extracted.files.map((file) => {
          return file.path
        }).sort()).toEqual(['SKILL.md', 'references/notes.md'])
      }
    })
  })

  describe('GET detail and DELETE', () => {
    it('returns the detail', async () => {
      const { result } = await call('detail')

      expect(result).toMatchObject({
        id: skillId,
        name: 'review-pr',
        currentVersion: 1,
        licence: { class: 'authored', filesLocked: false },
      })
      expect(result.files).toHaveLength(2)
      expect(result).not.toHaveProperty('userId')
    })

    it('deletes the skill and its objects', async () => {
      const { result } = await call('remove')

      expect(result).toEqual({ id: skillId, deleted: true })
      expect(await testDb.db.select().from(schema.skills)).toEqual([])
      expect(await testDb.db.select().from(schema.skillFiles)).toEqual([])
      expect(bucket.objects.size).toBe(0)
      expect(JSON.stringify(mocks.logger.set.mock.calls)).toContain(skillId)
    })
  })
})
