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
  createSkillsRouteEvent,
  stubSkillsRouteGlobals,
} from '../../../../../setup/helpers/skills-route'
import { skillMarkdown } from '../../../../../setup/helpers/skill-archives'

const mocks = vi.hoisted(() => ({
  featureOn: true,
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
    if (!mocks.featureOn || flag !== 'skills') {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }

    return { active: true }
  },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

async function callText(body: unknown, headers: Record<string, string> = {}) {
  const { default: handler } = await import(
    '~~/server/api/v1/skills/import/text.post'
  )

  return await (handler as (input: unknown) => Promise<any>)(
    createSkillsRouteEvent({ body, headers }),
  )
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string }
  }

  throw new Error('Expected a rejection')
}

describe('POST /api/v1/skills/import/text', () => {
  let kv: FakeSkillKv
  let bucket: FakeSkillBucket

  beforeEach(() => {
    mocks.featureOn = true
    kv = createFakeSkillKv()
    bucket = createFakeSkillBucket()
    stubSkillsRouteGlobals({ userId: 5, db: null, kv, bucket })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('answers 404 when the skills flag is off', async () => {
    mocks.featureOn = false

    expect((await failureOf(callText({ text: skillMarkdown() }))).status)
      .toBe(404)
    expect(kv.put).not.toHaveBeenCalled()
  })

  it('stages pasted SKILL.md text as an import with class none', async () => {
    const preview = await callText({ text: skillMarkdown() })

    expect(preview).toMatchObject({
      source: 'text',
      skill: { name: 'review-pr' },
      licence: { class: 'none' },
      requiresLicenceAcknowledgement: true,
      files: [{ path: 'SKILL.md', kind: 'skill-md' }],
    })
    expect(preview.sourceVersion).toMatch(/^sha256-[a-f0-9]{16}$/)
  })

  it('blocks a pasted skill whose license field says Proprietary', async () => {
    const failure = await failureOf(callText({
      text: skillMarkdown({ extra: 'license: Proprietary' }),
    }))

    expect(failure).toMatchObject({ status: 422, code: 'licence-restricted' })
    expect([...kv.values.keys()].some((key) => {
      return key.startsWith('skills:stage:')
    })).toBe(false)
  })

  it('lets an open license field name an open licence and stays an import', async () => {
    const preview = await callText({
      text: skillMarkdown({ extra: 'license: MIT' }),
    })

    expect(preview.licence).toMatchObject({
      class: 'open',
      matched: ['field-only'],
    })
    expect(preview.licence.class).not.toBe('authored')
  })

  it('rejects invalid frontmatter, an empty body and an oversized paste', async () => {
    expect(await failureOf(callText({ text: 'no frontmatter' })))
      .toMatchObject({ status: 400, code: 'frontmatter-missing' })
    expect((await failureOf(callText({ text: '' }))).status).toBe(400)
    expect((await failureOf(callText({}))).status).toBe(400)
    expect((await failureOf(callText({ text: 'x'.repeat(256 * 1024 + 1) })))
      .status).toBe(400)
  })

  it('rejects a paste whose UTF-8 size is over 256 KiB', async () => {
    const text = skillMarkdown({ body: 'я'.repeat(140 * 1024) })

    expect(await failureOf(callText({ text }))).toMatchObject({
      status: 413,
      code: 'skill-md-too-large',
    })
  })

  it('answers 413 before parsing a body over 1 MiB', async () => {
    expect((await failureOf(callText(
      { text: skillMarkdown() },
      { 'content-length': String(2 * 1024 * 1024) },
    ))).status).toBe(413)
  })

  it('rejects binary data in the text', async () => {
    expect((await failureOf(callText({
      text: skillMarkdown({ body: 'a\u0000b' }),
    }))).status).toBe(400)
  })

  it('counts pastes in the same hourly limit as uploads', async () => {
    for (let index = 0; index < 10; index += 1) {
      await callText({ text: skillMarkdown() })
    }

    expect((await failureOf(callText({ text: skillMarkdown() }))).status)
      .toBe(429)
  })
})
