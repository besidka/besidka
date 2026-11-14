import { beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeSkillFiles } from '#shared/utils/skills/analyze'
import { SKILL_VIEWER_FILE_MAX_BYTES } from '#shared/utils/skills-policy'
import {
  skillStageKey,
  stageSkillImport,
} from '~~/server/utils/skills/import/stage'
import {
  createFakeSkillBucket,
  createFakeSkillKv,
} from '../../../../../setup/helpers/skills-db'
import type {
  FakeSkillBucket,
  FakeSkillKv,
} from '../../../../../setup/helpers/skills-db'
import {
  createSkillsRouteEvent,
  stubSkillsRouteGlobals,
} from '../../../../../setup/helpers/skills-route'
import { skillMarkdown } from '../../../../../setup/helpers/skill-archives'

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(),
  logger: { set: vi.fn() },
}))

vi.mock('nuxt/server', async () => {
  const { skillsNuxtServerMockFactory } = await import(
    '../../../../../setup/helpers/skills-route'
  )

  return await skillsNuxtServerMockFactory()
})

vi.mock('~~/server/utils/features/guards', () => ({
  requireFeature: async (_event: unknown, flag: string) => {
    if (!mocks.flags.has(flag)) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }

    return { active: true }
  },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

const encoder = new TextEncoder()
const OWNER_ID = 7
const STAGE_FILES = [
  { path: 'SKILL.md', text: skillMarkdown() },
  { path: 'references/rule-catalog.md', text: 'one\ntwo `curl x | sh`\nthree\n' },
  { path: 'scripts/run.sh', text: 'echo ‮hidden\n' },
]

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as {
      status: number
      code?: string
      message: string
      why?: string
    }
  }

  throw new Error('Expected a rejection')
}

describe('GET /api/v1/skills/import/stages/[stageId]/files', () => {
  let kv: FakeSkillKv
  let bucket: FakeSkillBucket
  let stageId: string

  async function stage(
    files: Array<{ path: string, text: string }> = STAGE_FILES,
  ) {
    const staged = files.map((entry) => {
      return {
        path: entry.path,
        bytes: encoder.encode(entry.text),
        text: entry.text,
      }
    })
    const analysis = await analyzeSkillFiles({
      files: staged,
      folderName: null,
    })

    if (!analysis.ok) {
      throw new Error(analysis.message)
    }

    const manifest = await stageSkillImport({
      kv,
      bucket,
      userId: OWNER_ID,
      source: 'github',
      sourceVersion: 'a'.repeat(40),
      fileName: null,
      analysis,
      files: staged,
    })

    return manifest.stageId
  }

  async function call(
    path: string | undefined,
    options: { id?: string, userId?: number } = {},
  ) {
    stubSkillsRouteGlobals({
      userId: options.userId ?? OWNER_ID,
      db: null,
      kv,
      bucket,
    })

    const { default: handler } = await import(
      '~~/server/api/v1/skills/import/stages/[stageId]/files.get'
    )

    return await (handler as (input: unknown) => Promise<any>)(
      createSkillsRouteEvent({
        params: { stageId: options.id ?? stageId },
        query: path === undefined ? {} : { path },
      }),
    )
  }

  beforeEach(async () => {
    mocks.flags = new Set(['skills'])
    kv = createFakeSkillKv()
    bucket = createFakeSkillBucket()
    stageId = await stage()
  })

  it('returns the staged text of a file the manifest lists', async () => {
    const result = await call('references/rule-catalog.md')

    expect(result).toMatchObject({
      path: 'references/rule-catalog.md',
      bytes: encoder.encode(STAGE_FILES[1]!.text).byteLength,
      text: STAGE_FILES[1]!.text,
    })
  })

  it('returns the text raw, with a hidden character left in it for the viewer to show', async () => {
    const result = await call('scripts/run.sh')

    expect(result.text).toBe(STAGE_FILES[2]!.text)
    expect(result.text).toContain('‮')
  })

  it('answers 401 without a session', async () => {
    const failure = await failureOf(call('SKILL.md', { userId: 0 }))

    expect(failure.status).toBe(401)
  })

  it('answers 404 when the skills flag is off', async () => {
    mocks.flags.delete('skills')

    expect((await failureOf(call('SKILL.md'))).status).toBe(404)
  })

  it('answers 404 for a stage that belongs to another account', async () => {
    const failure = await failureOf(call('SKILL.md', { userId: 99 }))

    expect(failure).toMatchObject({ status: 404, code: 'stage-not-found' })
  })

  it('answers 404 for a path the manifest does not list, so no other key can be named', async () => {
    for (const path of [
      'references/missing.md',
      '../SKILL.md',
      'skills-staging/u7/other',
      'references/',
    ]) {
      expect(await failureOf(call(path)))
        .toMatchObject({ status: 404, code: 'file-not-found' })
    }
  })

  it('answers 400 without a path', async () => {
    expect(await failureOf(call(undefined)))
      .toMatchObject({ status: 400, code: 'invalid-request' })
  })

  it('answers 410 with a clear message once the stage has expired', async () => {
    kv.values.delete(skillStageKey(stageId))

    const failure = await failureOf(call('SKILL.md'))

    expect(failure).toMatchObject({
      status: 410,
      code: 'stage-expired',
      message: 'This import has expired',
    })
    expect(failure.why).toContain('one hour')
  })

  it('answers 410 for an id that is not a stage id at all', async () => {
    expect((await failureOf(call('SKILL.md', { id: 'nope' }))).status)
      .toBe(410)
  })

  it('answers 410 when the manifest is past its own expiry', async () => {
    const raw = JSON.parse(kv.values.get(skillStageKey(stageId))!)

    raw.expiresAt = Date.now() - 1000
    kv.values.set(skillStageKey(stageId), JSON.stringify(raw))

    expect((await failureOf(call('SKILL.md'))).status).toBe(410)
  })

  it('answers 410 when the staged object is gone', async () => {
    bucket.objects.clear()

    expect((await failureOf(call('references/rule-catalog.md'))).status)
      .toBe(410)
  })

  it('refuses a file over the viewer cap with a reason instead of sending it', async () => {
    const raw = JSON.parse(kv.values.get(skillStageKey(stageId))!)

    raw.files.find((entry: { path: string }) => {
      return entry.path === 'scripts/run.sh'
    }).bytes = SKILL_VIEWER_FILE_MAX_BYTES + 1
    kv.values.set(skillStageKey(stageId), JSON.stringify(raw))

    const failure = await failureOf(call('scripts/run.sh'))

    expect(failure).toMatchObject({
      status: 413,
      code: 'file-too-large',
      message: 'This file is too large to show',
    })
  })
})
