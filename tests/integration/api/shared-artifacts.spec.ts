import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  minutesBefore,
  seedChat,
  seedMessage,
  seedUser,
  textPart,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { createMemoryBlobStore } from '../../setup/helpers/artifacts-store'
import type { MemoryBlobStore } from '../../setup/helpers/artifacts-store'

const SHARE_SLUG = '01JSHAREDARTIFACTSSLUG0001'

const mocks = vi.hoisted(() => ({
  logger: { set: vi.fn() },
  storage: null as unknown as MemoryBlobStore,
  sessionUserId: 0,
  featuresDisabled: '',
  rules: {} as Record<string, unknown>,
  kv: new Map<string, string>(),
  sendEmail: vi.fn(async () => ({ messageId: 'message-1' })),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

vi.mock('~~/server/utils/artifacts/blob-store', () => ({
  useArtifactBlobStore: () => mocks.storage,
}))

vi.mock('~~/server/utils/email-template', () => ({
  renderTemplateEmail: async () => ({ html: '<p>email</p>', text: 'email' }),
  sendRenderedEmail: mocks.sendEmail,
}))

vi.mock('~~/server/utils/features/context', async () => {
  const { getFeatureEvaluationConfig } = await import(
    '~~/server/utils/features/evaluate'
  )

  return {
    useFeatureContext: async () => ({
      userId: null,
      rules: mocks.rules,
      userState: null,
      config: getFeatureEvaluationConfig({
        featuresHostMode: 'byok',
        featuresDisabled: mocks.featuresDisabled,
      }),
      isAdmin: false,
      exposures: new Set<string>(),
    }),
    evaluateFeatureForEvent: vi.fn(),
  }
})

const runtimeConfig = (await import('#app/nuxt')).useRuntimeConfig() as
  unknown as Record<string, unknown> & { public: Record<string, unknown> }
const {
  appendArtifactVersion,
  createArtifact,
  deleteArtifacts,
} = await import('~~/server/utils/artifacts/store')
const { ARTIFACT_REPORT_RATE_LIMIT } = await import(
  '~~/server/utils/artifacts/report-rate-limit'
)

async function importHandler(path: string) {
  const module = await import(path)

  return module.default as (event: unknown) => Promise<any>
}

const handlers = {
  version: () => importHandler(
    '../../../server/api/v1/shared/[slug]/artifacts/[artifactId]/versions/[version].get',
  ),
  report: () => importHandler(
    '../../../server/api/v1/shared/[slug]/artifacts/[artifactId]/report.post',
  ),
}

function createEvent(input: {
  params?: Record<string, string>
  body?: unknown
  headers?: Record<string, string>
} = {}) {
  return {
    context: {},
    params: input.params ?? {},
    body: input.body,
    headers: input.headers ?? {},
    res: { headers: new Headers() },
  }
}

function artifactPart(artifactId: string, version: number, title: string) {
  return {
    type: 'data-artifact',
    data: { artifactId, version, kind: 'html', title },
  }
}

function disabledRule() {
  return {
    flag: 'artifacts',
    enabled: false,
    rolloutBps: 0,
    allowRoles: null,
    variants: null,
    salt: 'salt',
  }
}

describe('shared chat artifacts API', () => {
  let testDb: MemoryExtractionTestDb
  let ownerId: number
  let strangerId: number

  beforeEach(() => {
    testDb = createMemoryExtractionTestDb()
    mocks.storage = createMemoryBlobStore()
    mocks.sessionUserId = 0
    mocks.featuresDisabled = ''
    mocks.rules = {}
    mocks.kv = new Map()
    mocks.logger.set.mockClear()
    mocks.sendEmail.mockClear()

    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useEvent', () => ({ context: {} }))
    Object.assign(runtimeConfig, {
      turnstileSecretKey: '',
      turnstileEnforced: false,
    })
    Object.assign(runtimeConfig.public, {
      baseUrl: 'https://besidka.test',
      privacyEmail: 'privacy@besidka.test',
      turnstileSiteKey: '',
    })
    vi.stubGlobal('useKV', () => ({
      get: async (key: string) => mocks.kv.get(key) ?? null,
      put: async (key: string, value: string) => {
        mocks.kv.set(key, value)
      },
      delete: async (key: string) => {
        mocks.kv.delete(key)
      },
    }))
    vi.stubGlobal('useUserSession', async () => {
      return mocks.sessionUserId
        ? { user: { id: String(mocks.sessionUserId) } }
        : null
    })
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
    vi.stubGlobal('getRequestHeader', (
      event: { headers: Record<string, string> },
      name: string,
    ) => event.headers[name.toLowerCase()])
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      validate: (value: unknown) => unknown,
    ) => validate(event.body))
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  async function seedSharedChat(
    share: Partial<typeof schema.chatShares.$inferInsert> = {},
  ) {
    ownerId = await seedUser(testDb.db, null)
    strangerId = await seedUser(testDb.db, null)

    const chat = await seedChat(testDb.db, ownerId)
    const quiz = await createArtifact({
      db: testDb.db,
      storage: mocks.storage,
      userId: ownerId,
      kind: 'html',
      title: 'Quiz',
      content: '<p>v1</p>',
      originChatId: chat.id,
      createdVia: 'chat',
      createdBy: 'model',
    })

    await appendArtifactVersion({
      db: testDb.db,
      storage: mocks.storage,
      userId: ownerId,
      artifactId: quiz.artifactId,
      title: 'Quiz renamed',
      content: '<p>v2 private</p>',
      createdBy: 'model',
    })

    const foreign = await createArtifact({
      db: testDb.db,
      storage: mocks.storage,
      userId: strangerId,
      kind: 'html',
      title: 'Stranger art',
      content: '<p>stranger</p>',
      createdVia: 'chat',
      createdBy: 'model',
    })

    await seedMessage(
      testDb.db,
      chat.id,
      'user',
      [textPart('Make a quiz')],
      minutesBefore(30),
    )
    await seedMessage(
      testDb.db,
      chat.id,
      'assistant',
      [
        textPart('Here it is'),
        artifactPart(quiz.artifactId, 1, 'Quiz'),
        artifactPart(foreign.artifactId, 1, 'Stranger art'),
      ],
      minutesBefore(29),
    )
    await testDb.db.insert(schema.chatShares).values({
      chatId: chat.id,
      slug: SHARE_SLUG,
      ...share,
    })

    return { chat, quiz, foreign }
  }

  async function readVersion(artifactId: string, version: string) {
    const handler = await handlers.version()
    const event = createEvent({
      params: { slug: SHARE_SLUG, artifactId, version },
    })

    return { event, result: handler(event) }
  }

  describe('version read', () => {
    it('serves a referenced version with a private no-store header',
      async () => {
        const { quiz } = await seedSharedChat()
        const { event, result } = await readVersion(quiz.artifactId, '1')

        await expect(result).resolves.toEqual({
          artifactId: quiz.artifactId,
          kind: 'html',
          title: 'Quiz',
          version: 1,
          content: '<p>v1</p>',
          sizeBytes: 9,
          createdAt: expect.any(String),
        })
        expect(event.res.headers.get('Cache-Control'))
          .toBe('private, no-store')
        expect(JSON.stringify(mocks.logger.set.mock.calls))
          .not.toContain('<p>v1</p>')
      })

    it('returns the title of the shared part for each version, never '
      + 'the current title', async () => {
      const { chat, quiz } = await seedSharedChat()

      await seedMessage(
        testDb.db,
        chat.id,
        'assistant',
        [artifactPart(quiz.artifactId, 2, 'Quiz v2 as shared')],
        minutesBefore(28),
      )

      const first = await readVersion(quiz.artifactId, '1')
      const second = await readVersion(quiz.artifactId, '2')

      await expect(first.result).resolves.toMatchObject({
        version: 1,
        title: 'Quiz',
      })
      await expect(second.result).resolves.toMatchObject({
        version: 2,
        title: 'Quiz v2 as shared',
        content: '<p>v2 private</p>',
      })
    })

    it('answers 404 for a version the shared messages do not reference',
      async () => {
        const { quiz } = await seedSharedChat()
        const { event, result } = await readVersion(quiz.artifactId, '2')

        await expect(result).rejects.toMatchObject({ status: 404 })
        expect(event.res.headers.get('Cache-Control'))
          .toBe('private, no-store')
      })

    it('answers 404 for unknown and malformed artifact ids', async () => {
      await seedSharedChat()

      await expect((await readVersion('pub-9999', '1')).result)
        .rejects.toMatchObject({ status: 404 })
      await expect((await readVersion('not-an-id', '1')).result)
        .rejects.toMatchObject({ status: 404 })
    })

    it('answers 400 for an invalid version', async () => {
      const { quiz } = await seedSharedChat()

      await expect((await readVersion(quiz.artifactId, '0')).result)
        .rejects.toMatchObject({ status: 400 })
      await expect((await readVersion(quiz.artifactId, 'abc')).result)
        .rejects.toMatchObject({ status: 400 })
    })

    it('answers 404 for another user artifact referenced in the chat',
      async () => {
        const { foreign } = await seedSharedChat()

        await expect((await readVersion(foreign.artifactId, '1')).result)
          .rejects.toMatchObject({ status: 404 })
      })

    it('answers 404 for a revoked share', async () => {
      const { quiz } = await seedSharedChat({ revoked: true })

      await expect((await readVersion(quiz.artifactId, '1')).result)
        .rejects.toMatchObject({ status: 404 })
    })

    it('answers 404 for an expired share', async () => {
      const { quiz } = await seedSharedChat({
        expiresAt: minutesBefore(1, new Date()),
      })

      await expect((await readVersion(quiz.artifactId, '1')).result)
        .rejects.toMatchObject({ status: 404 })
    })

    it('answers 404 after the artifact is deleted', async () => {
      const { quiz } = await seedSharedChat()

      await deleteArtifacts({
        db: testDb.db,
        storage: mocks.storage,
        userId: ownerId,
        artifactIds: [quiz.artifactId],
      })

      await expect((await readVersion(quiz.artifactId, '1')).result)
        .rejects.toMatchObject({ status: 404 })
    })

    it('answers 410 for a taken-down artifact', async () => {
      const { quiz } = await seedSharedChat()

      await testDb.db.update(schema.artifacts)
        .set({ takedownAt: new Date(), takedownReason: 'report' })
        .where(eq(schema.artifacts.userId, ownerId))

      await expect((await readVersion(quiz.artifactId, '1')).result)
        .rejects.toMatchObject({ status: 410, code: 'artifact_taken_down' })
    })

    it('answers 404 when the admin rule disables artifacts', async () => {
      const { quiz } = await seedSharedChat()

      mocks.rules = { artifacts: disabledRule() }

      await expect((await readVersion(quiz.artifactId, '1')).result)
        .rejects.toMatchObject({ status: 404 })
    })

    it('answers 404 when the env kill switch lists artifacts', async () => {
      const { quiz } = await seedSharedChat()

      mocks.featuresDisabled = 'artifacts'

      await expect((await readVersion(quiz.artifactId, '1')).result)
        .rejects.toMatchObject({ status: 404 })
    })

    it('ignores data-artifact parts in other chats', async () => {
      const { quiz } = await seedSharedChat()
      const otherChat = await seedChat(testDb.db, ownerId)

      await seedMessage(
        testDb.db,
        otherChat.id,
        'assistant',
        [artifactPart(quiz.artifactId, 2, 'Quiz renamed')],
        minutesBefore(10),
      )

      await expect((await readVersion(quiz.artifactId, '2')).result)
        .rejects.toMatchObject({ status: 404 })
    })
  })

  describe('report', () => {
    async function report(
      artifactId: string,
      body: unknown,
      headers: Record<string, string> = { 'cf-connecting-ip': '203.0.113.7' },
    ) {
      const handler = await handlers.report()
      const event = createEvent({
        params: { slug: SHARE_SLUG, artifactId },
        body,
        headers,
      })

      return { event, result: handler(event) }
    }

    async function listReports() {
      return await testDb.db.select().from(schema.artifactReports)
    }

    it('stores an anonymous report with normal priority', async () => {
      const { quiz } = await seedSharedChat()
      const { result } = await report(quiz.artifactId, {
        reason: 'phishing',
        details: '  Asks for a bank password on a fake login form  ',
        reporterName: 'Ann',
        reporterEmail: 'ann@example.test',
        goodFaith: true,
      })

      await expect(result).resolves.toEqual({ ok: true })

      const [row] = await listReports()

      expect(row).toMatchObject({
        artifactId: Number(quiz.artifactId.slice(4)),
        shareId: null,
        chatShareId: expect.any(String),
        reporterUserId: null,
        reporterName: 'Ann',
        reporterEmail: 'ann@example.test',
        reason: 'phishing',
        details: 'Asks for a bank password on a fake login form',
        status: 'open',
        priority: 'normal',
        receiptSentAt: expect.any(Date),
      })
      expect(mocks.sendEmail).toHaveBeenCalledTimes(2)
    })

    it('marks csam, terrorism and threat-to-life urgent', async () => {
      const { quiz } = await seedSharedChat()

      await (await report(quiz.artifactId, {
        reason: 'csam',
        details: 'Abuse material in the shared artifact',
        goodFaith: true,
      })).result
      await (await report(quiz.artifactId, {
        reason: 'threat-to-life',
        details: 'Threatens a named person with violence',
        reporterName: 'Bo',
        reporterEmail: 'bo@example.test',
        goodFaith: true,
      })).result

      const rows = await listReports()

      expect(rows.map((row) => {
        return [row.reason, row.priority, row.reporterName]
      })).toEqual([
        ['csam', 'urgent', null],
        ['threat-to-life', 'urgent', 'Bo'],
      ])
    })

    it('records the signed-in reporter', async () => {
      const { quiz } = await seedSharedChat()

      mocks.sessionUserId = strangerId

      await (await report(quiz.artifactId, {
        reason: 'other',
        details: 'Spam that links to a scam site',
        reporterName: 'Cy',
        reporterEmail: 'cy@example.test',
        goodFaith: true,
      }, {})).result

      const [row] = await listReports()

      expect(row?.reporterUserId).toBe(strangerId)
    })

    it('rejects invalid bodies', async () => {
      const { quiz } = await seedSharedChat()
      const details = 'This artifact breaks the rules'
      const invalidBodies = [
        {
          reason: 'spam',
          details,
          reporterName: 'A',
          reporterEmail: 'a@b.co',
          goodFaith: true,
        },
        { reason: 'illegal', details, goodFaith: true },
        { reason: 'illegal', details, reporterName: 'A', goodFaith: true },
        {
          reason: 'illegal',
          details,
          reporterName: 'A',
          reporterEmail: 'not-an-email',
          goodFaith: true,
        },
        { reason: 'csam', details: '   ', goodFaith: true },
        { reason: 'csam', details: 'too short', goodFaith: true },
        { reason: 'csam', details: 'x'.repeat(2001), goodFaith: true },
        { reason: 'csam', details },
        { reason: 'csam', details, goodFaith: false },
        {
          reason: 'copyright',
          details,
          reporterName: 'A',
          reporterEmail: 'a@b.co',
          goodFaith: true,
        },
      ]

      for (const body of invalidBodies) {
        await expect((await report(quiz.artifactId, body)).result)
          .rejects.toMatchObject({ status: 400 })
      }

      expect(await listReports()).toHaveLength(0)
    })

    it('answers 404 for an artifact the shared chat does not include',
      async () => {
        const { foreign } = await seedSharedChat()

        await expect((await report(foreign.artifactId, {
          reason: 'csam',
          details: 'x'.repeat(20),
          goodFaith: true,
        })).result).rejects.toMatchObject({ status: 404 })
        await expect((await report('pub-9999', {
          reason: 'csam',
          details: 'x'.repeat(20),
          goodFaith: true,
        })).result).rejects.toMatchObject({ status: 404 })
        expect(await listReports()).toHaveLength(0)
      })

    it('answers 404 when the kill switch is on', async () => {
      const { quiz } = await seedSharedChat()

      mocks.featuresDisabled = '*'

      await expect((await report(quiz.artifactId, {
        reason: 'csam',
        details: 'x'.repeat(20),
        goodFaith: true,
      })).result).rejects.toMatchObject({ status: 404 })
    })

    it('rate limits reports per client IP', async () => {
      const { quiz } = await seedSharedChat()
      const body = {
        reason: 'csam',
        details: 'x'.repeat(20),
        goodFaith: true,
      }

      for (let index = 0; index < ARTIFACT_REPORT_RATE_LIMIT.max; index++) {
        await expect((await report(quiz.artifactId, body)).result)
          .resolves.toEqual({ ok: true })
      }

      const limited = await report(quiz.artifactId, body)

      await expect(limited.result).rejects.toMatchObject({ status: 429 })
      expect(Number(limited.event.res.headers.get('Retry-After')))
        .toBeGreaterThan(0)
      await expect((await report(quiz.artifactId, body, {
        'cf-connecting-ip': '198.51.100.9',
      })).result).resolves.toEqual({ ok: true })
      expect(await listReports())
        .toHaveLength(ARTIFACT_REPORT_RATE_LIMIT.max + 1)
    })
  })
})
