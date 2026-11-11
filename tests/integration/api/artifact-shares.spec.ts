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

const BASE_URL = 'https://besidka.test'
const PRIVACY_EMAIL = 'privacy@besidka.test'
const CLIENT_IP = '203.0.113.7'
const SHARE_HEADER = 'x-besidka-artifact-share'
const CHAT_SHARE_SLUG = '01JARTIFACTSHARESCHAT00001'
const DETAILS = 'This artifact asks visitors for their bank password.'
const STATEMENT = 'The artifact imitates a bank sign-in form and asks for '
  + 'passwords, which the Terms of Use prohibit (What you may not do).'

const mocks = vi.hoisted(() => ({
  logger: { set: vi.fn() },
  storage: null as unknown as MemoryBlobStore,
  sessionUserId: 0,
  isAdmin: false,
  flagActive: true,
  featuresDisabled: '',
  rules: {} as Record<string, unknown>,
  kv: new Map<string, string>(),
  sendEmail: vi.fn(async (_input: Record<string, unknown>) => {
    return { messageId: 'message-1' }
  }),
  fetch: vi.fn(),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/encryption', () => ({
  useEncryptText: async (plain: string) => `enc:${plain}`,
  useDecryptText: async (encrypted: string) => encrypted.slice(4),
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

vi.mock('~~/server/utils/artifacts/blob-store', () => ({
  useArtifactBlobStore: () => mocks.storage,
}))

vi.mock('~~/server/utils/email-template', () => ({
  renderTemplateEmail: async (input: { props: { body: string } }) => {
    return { html: `<p>${input.props.body}</p>`, text: input.props.body }
  },
  sendRenderedEmail: mocks.sendEmail,
}))

vi.mock('~~/server/utils/features/context', async () => {
  const { getFeatureEvaluationConfig } = await import(
    '~~/server/utils/features/evaluate'
  )

  return {
    useFeatureContext: async () => ({
      userId: mocks.sessionUserId || null,
      rules: mocks.rules,
      userState: null,
      config: getFeatureEvaluationConfig({
        featuresHostMode: 'byok',
        featuresDisabled: mocks.featuresDisabled,
      }),
      isAdmin: mocks.isAdmin,
      exposures: new Set<string>(),
    }),
    evaluateFeatureForEvent: async () => ({
      active: mocks.flagActive,
      value: mocks.flagActive,
      reason: 'TEST',
    }),
  }
})

const runtimeConfig = (await import('#app/nuxt')).useRuntimeConfig() as
  unknown as Record<string, unknown> & { public: Record<string, unknown> }
const { appendArtifactVersion, createArtifact, deleteArtifacts }
  = await import('~~/server/utils/artifacts/store')
const { ARTIFACT_REPORT_RATE_LIMIT } = await import(
  '~~/server/utils/artifacts/report-rate-limit'
)

async function importHandler(path: string) {
  const module = await import(path)

  return module.default as (event: unknown) => Promise<any>
}

const handlers = {
  createShare: () => importHandler(
    '../../../server/api/v1/artifacts/[id]/shares/index.post',
  ),
  listShares: () => importHandler(
    '../../../server/api/v1/artifacts/[id]/shares/index.get',
  ),
  checkShare: () => importHandler(
    '../../../server/api/v1/artifacts/[id]/shares/check.post',
  ),
  revokeShare: () => importHandler(
    '../../../server/api/v1/artifacts/[id]/shares/[shareId]/revoke.post',
  ),
  publicRead: () => importHandler(
    '../../../server/api/v1/artifact-shares/current/index.get',
  ),
  publicReport: () => importHandler(
    '../../../server/api/v1/artifact-shares/current/report.post',
  ),
  chatReport: () => importHandler(
    '../../../server/api/v1/shared/[slug]/artifacts/[artifactId]/report.post',
  ),
  adminList: () => importHandler(
    '../../../server/api/v1/admin/artifact-reports/index.get',
  ),
  adminDetail: () => importHandler(
    '../../../server/api/v1/admin/artifact-reports/[id]/index.get',
  ),
  adminAction: () => importHandler(
    '../../../server/api/v1/admin/artifact-reports/[id]/action.post',
  ),
  adminVersion: () => importHandler(
    '../../../server/api/v1/admin/artifacts/[id]/versions/[version].get',
  ),
  adminTakedown: () => importHandler(
    '../../../server/api/v1/admin/artifact-takedowns/index.post',
  ),
  adminRestore: () => importHandler(
    '../../../server/api/v1/admin/artifact-takedowns/restore.post',
  ),
}

function createEvent(input: {
  params?: Record<string, string>
  body?: unknown
  headers?: Record<string, string>
  query?: Record<string, string>
} = {}) {
  return {
    context: {},
    params: input.params ?? {},
    body: input.body,
    query: input.query ?? {},
    headers: input.headers ?? {},
    res: { headers: new Headers() },
  }
}

async function call(
  handler: () => Promise<(event: unknown) => Promise<any>>,
  input: Parameters<typeof createEvent>[0] = {},
) {
  const event = createEvent(input)

  try {
    return { event, result: await (await handler())(event), error: null }
  } catch (exception) {
    return { event, result: null, error: exception as Record<string, any> }
  }
}

function emailArguments(): string {
  return JSON.stringify(mocks.sendEmail.mock.calls)
}

function sentEmails() {
  return mocks.sendEmail.mock.calls.map(([input]) => {
    return input as { to: string, subject: string, text: string }
  })
}

describe('artifact shares API', () => {
  let testDb: MemoryExtractionTestDb
  let ownerId: number
  let ownerEmail: string
  let viewerId: number
  let adminId: number
  let artifactId: string

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    mocks.storage = createMemoryBlobStore()
    mocks.sessionUserId = 0
    mocks.isAdmin = false
    mocks.flagActive = true
    mocks.featuresDisabled = ''
    mocks.rules = {}
    mocks.kv = new Map()
    mocks.logger.set.mockClear()
    mocks.sendEmail.mockClear()
    mocks.fetch.mockReset()

    Object.assign(runtimeConfig, {
      turnstileSecretKey: '',
      turnstileEnforced: false,
      authAdditionalAllowedHosts: '',
      encryptionKey: 'test-encryption-key',
    })
    Object.assign(runtimeConfig.public, {
      baseUrl: BASE_URL,
      privacyEmail: PRIVACY_EMAIL,
      turnstileSiteKey: '',
    })

    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useEvent', () => ({ context: {} }))
    vi.stubGlobal('fetch', mocks.fetch)
    vi.stubGlobal('assertNotCrossSiteRequest', () => {})
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
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
    vi.stubGlobal('getValidatedQuery', async (
      event: { query: unknown },
      validate: (value: unknown) => unknown,
    ) => validate(event.query))

    ownerId = await seedUser(testDb.db, null)
    viewerId = await seedUser(testDb.db, null)
    adminId = await seedUser(testDb.db, null)

    const [owner] = await testDb.db.select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, ownerId))

    ownerEmail = owner!.email

    const created = await createArtifact({
      db: testDb.db,
      storage: mocks.storage,
      userId: ownerId,
      kind: 'html',
      title: 'Bank quiz',
      content: '<p>v1</p>',
      createdVia: 'chat',
      createdBy: 'model',
    })

    artifactId = created.artifactId
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  async function createShare(body: Record<string, unknown> = {}) {
    mocks.sessionUserId = ownerId

    const response = await call(handlers.createShare, {
      params: { id: artifactId },
      body: {
        duration: 'never',
        pinnedVersion: null,
        storageAllowed: false,
        bridgeAllowed: false,
        ...body,
      },
    })

    mocks.sessionUserId = 0

    if (response.error) {
      throw response.error
    }

    return {
      ...response.result as { share: Record<string, any>, url: string },
      token: (response.result.url as string).split('/a/')[1]!,
    }
  }

  function readShare(token: string | null) {
    return call(handlers.publicRead, {
      headers: token ? { [SHARE_HEADER]: token } : {},
    })
  }

  function reportShare(
    token: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = { 'cf-connecting-ip': CLIENT_IP },
  ) {
    return call(handlers.publicReport, {
      headers: { [SHARE_HEADER]: token, ...headers },
      body: {
        reason: 'phishing',
        details: DETAILS,
        reporterName: 'Ann Reporter',
        reporterEmail: 'ann@example.test',
        goodFaith: true,
        ...body,
      },
    })
  }

  async function listReports() {
    return await testDb.db.select().from(schema.artifactReports)
  }

  async function listAudit() {
    return await testDb.db.select().from(schema.featureAuditLog)
  }

  function asAdmin() {
    mocks.sessionUserId = adminId
    mocks.isAdmin = true
  }

  describe('owner routes', () => {
    it('creates a link and returns its summary and URL', async () => {
      const created = await createShare({
        duration: 'day',
        storageAllowed: true,
      })

      expect(created.url).toBe(`${BASE_URL}/a/${created.token}`)
      expect(created.token).toMatch(/^[\w-]{43}$/)
      expect(created.share).toMatchObject({
        shareId: expect.stringMatching(/^sh_/),
        url: created.url,
        createdVia: 'ui',
        clientName: null,
        pinnedVersion: null,
        expiresAt: expect.any(String),
        revokedAt: null,
        takedownAt: null,
        storageAllowed: true,
        bridgeAllowed: false,
        status: 'active',
      })
      expect(JSON.stringify(mocks.logger.set.mock.calls))
        .not.toContain(created.token)
    })

    it('refuses owner writes from a sibling site', async () => {
      const created = await createShare()
      const sameSite = { 'sec-fetch-site': 'same-site' }

      vi.stubGlobal('getRequestURL', () => new URL(BASE_URL))
      mocks.sessionUserId = ownerId

      await expect(call(handlers.createShare, {
        params: { id: artifactId },
        headers: sameSite,
        body: {
          duration: 'never',
          pinnedVersion: null,
          storageAllowed: false,
          bridgeAllowed: false,
        },
      })).resolves.toMatchObject({ error: { status: 403 } })
      await expect(call(handlers.checkShare, {
        params: { id: artifactId },
        headers: sameSite,
        body: { pinnedVersion: null },
      })).resolves.toMatchObject({ error: { status: 403 } })
      await expect(call(handlers.revokeShare, {
        params: { id: artifactId, shareId: created.share.shareId },
        headers: { origin: 'https://evil.example' },
      })).resolves.toMatchObject({ error: { status: 403 } })
      await expect(call(handlers.revokeShare, {
        params: { id: artifactId, shareId: created.share.shareId },
        headers: { 'sec-fetch-site': 'same-origin' },
      })).resolves.toMatchObject({ result: { revoked: 1 } })
    })

    it('keeps the title the link was created with', async () => {
      const created = await createShare()

      testDb.sqlite.prepare('update artifacts set title = ?')
        .run('Renamed after sharing')

      await expect(readShare(created.token)).resolves.toMatchObject({
        result: { title: 'Bank quiz' },
      })
    })

    it('lists, then revokes, a link', async () => {
      const created = await createShare()

      mocks.sessionUserId = ownerId

      const listed = await call(handlers.listShares, {
        params: { id: artifactId },
      })

      expect(listed.result.shares).toHaveLength(1)
      expect(listed.event.res.headers.get('Cache-Control'))
        .toBe('private, no-store')

      const revoked = await call(handlers.revokeShare, {
        params: { id: artifactId, shareId: created.share.shareId },
      })

      expect(revoked.result).toEqual({ revoked: 1 })

      const after = await call(handlers.listShares, {
        params: { id: artifactId },
      })

      expect(after.result.shares).toEqual([
        expect.objectContaining({ status: 'revoked', url: null }),
      ])
      expect(await testDb.db.select().from(schema.artifactShares))
        .toHaveLength(1)
    })

    it('hides another user artifact and its links', async () => {
      const created = await createShare()

      mocks.sessionUserId = viewerId

      await expect(call(handlers.listShares, { params: { id: artifactId } }))
        .resolves.toMatchObject({ error: { status: 404 } })
      await expect(call(handlers.revokeShare, {
        params: { id: artifactId, shareId: created.share.shareId },
      })).resolves.toMatchObject({ error: { status: 404 } })
      await expect(call(handlers.createShare, {
        params: { id: artifactId },
        body: {
          duration: 'never',
          pinnedVersion: null,
          storageAllowed: false,
          bridgeAllowed: false,
        },
      })).resolves.toMatchObject({ error: { status: 404 } })
    })

    it('stops creating links when artifacts.share is off but still lists '
      + 'and revokes the live ones', async () => {
      const created = await createShare()

      mocks.sessionUserId = ownerId
      mocks.flagActive = false

      await expect(call(handlers.createShare, {
        params: { id: artifactId },
        body: {
          duration: 'never',
          pinnedVersion: null,
          storageAllowed: false,
          bridgeAllowed: false,
        },
      })).resolves.toMatchObject({ error: { status: 404 } })
      await expect(call(handlers.checkShare, {
        params: { id: artifactId },
        body: { pinnedVersion: null },
      })).resolves.toMatchObject({ error: { status: 404 } })
      await expect(call(handlers.listShares, { params: { id: artifactId } }))
        .resolves.toMatchObject({
          result: { shares: [expect.objectContaining({ status: 'active' })] },
        })
      await expect(call(handlers.revokeShare, {
        params: { id: artifactId, shareId: created.share.shareId },
      })).resolves.toMatchObject({ result: { revoked: 1 } })
    })

    it('answers 404 to list and revoke when the global rule is off',
      async () => {
        const created = await createShare()

        mocks.sessionUserId = ownerId
        mocks.featuresDisabled = 'artifacts'

        await expect(call(handlers.listShares, { params: { id: artifactId } }))
          .resolves.toMatchObject({ error: { status: 404 } })
        await expect(call(handlers.revokeShare, {
          params: { id: artifactId, shareId: created.share.shareId },
        })).resolves.toMatchObject({ error: { status: 404 } })
      })

    it('rejects a pinned version that does not exist', async () => {
      await expect(createShare({ pinnedVersion: 3 }))
        .rejects.toMatchObject({ status: 400 })
    })

    it('warns about personal data before sharing', async () => {
      await appendArtifactVersion({
        db: testDb.db,
        storage: mocks.storage,
        userId: ownerId,
        artifactId,
        content: '<p>Write to jane.doe@gmail.com or +48 601 234 567</p>',
        createdBy: 'model',
      })

      mocks.sessionUserId = ownerId

      const latest = await call(handlers.checkShare, {
        params: { id: artifactId },
        body: { pinnedVersion: null },
      })
      const pinned = await call(handlers.checkShare, {
        params: { id: artifactId },
        body: { pinnedVersion: 1 },
      })

      expect(latest.result).toEqual({ warnings: ['email', 'phone'] })
      expect(pinned.result).toEqual({ warnings: [] })
    })
  })

  describe('public read', () => {
    it('serves an active link with private, no-referrer headers', async () => {
      const created = await createShare({ bridgeAllowed: true })
      const response = await readShare(created.token)

      expect(response.result).toEqual({
        shareId: created.share.shareId,
        artifactId,
        title: 'Bank quiz',
        kind: 'html',
        version: 1,
        pinned: false,
        content: '<p>v1</p>',
        createdAt: expect.any(String),
        expiresAt: null,
        capabilities: { storageAllowed: false, bridgeAllowed: true },
      })
      expect(response.event.res.headers.get('Cache-Control'))
        .toBe('private, no-store')
      expect(response.event.res.headers.get('Referrer-Policy'))
        .toBe('no-referrer')
      expect(JSON.stringify(mocks.logger.set.mock.calls))
        .not.toContain(created.token)
    })

    it('keeps a pinned link on its version and moves a latest link',
      async () => {
        const latest = await createShare()
        const pinned = await createShare({ pinnedVersion: 1 })

        await appendArtifactVersion({
          db: testDb.db,
          storage: mocks.storage,
          userId: ownerId,
          artifactId,
          content: '<p>v2</p>',
          createdBy: 'model',
        })

        await expect(readShare(latest.token)).resolves.toMatchObject({
          result: { version: 2, content: '<p>v2</p>', pinned: false },
        })
        await expect(readShare(pinned.token)).resolves.toMatchObject({
          result: { version: 1, content: '<p>v1</p>', pinned: true },
        })
      })

    it('answers 404 without a token, for an unknown, revoked or expired link',
      async () => {
        const revoked = await createShare()
        const expired = await createShare({ duration: 'hour' })

        mocks.sessionUserId = ownerId
        await call(handlers.revokeShare, {
          params: { id: artifactId, shareId: revoked.share.shareId },
        })
        mocks.sessionUserId = 0
        testDb.sqlite.prepare(
          'update artifact_shares set expires_at = 1 where id = ?',
        ).run(Number(expired.share.shareId.slice('sh_pub-'.length)))

        for (const token of [null, 'x'.repeat(43), revoked.token, expired.token]) {
          const response = await readShare(token)

          expect(response.error).toMatchObject({ status: 404 })
          expect(response.event.res.headers.get('Cache-Control'))
            .toBe('private, no-store')
        }
      })

    it('answers 410 with takenDown after a takedown', async () => {
      const created = await createShare()

      testDb.sqlite.prepare('update artifacts set takedown_at = 1').run()

      await expect(readShare(created.token)).resolves.toMatchObject({
        error: { status: 410, data: { takenDown: true } },
      })
    })

    it('answers 404 when the global artifacts rule is off', async () => {
      const created = await createShare()

      mocks.featuresDisabled = 'artifacts'

      await expect(readShare(created.token)).resolves.toMatchObject({
        error: { status: 404 },
      })
    })
  })

  describe('report', () => {
    function configureTurnstile() {
      Object.assign(runtimeConfig, { turnstileSecretKey: 'secret' })
      Object.assign(runtimeConfig.public, { turnstileSiteKey: 'site' })
    }

    it('accepts an anonymous report when Turnstile is not configured',
      async () => {
        const created = await createShare()
        const response = await reportShare(created.token, {})

        expect(response.result).toEqual({ ok: true })
        expect(mocks.fetch).not.toHaveBeenCalled()

        const [row] = await listReports()

        expect(row).toMatchObject({
          shareId: Number(created.share.shareId.slice('sh_pub-'.length)),
          chatShareId: null,
          reporterUserId: null,
          reason: 'phishing',
          priority: 'normal',
          status: 'open',
          receiptSentAt: expect.any(Date),
        })
        expect(sentEmails().map(email => email.to))
          .toEqual([PRIVACY_EMAIL, 'ann@example.test'])
        expect(emailArguments()).not.toContain(created.token)
        expect(emailArguments()).not.toContain(CLIENT_IP)
        expect(JSON.stringify(row)).not.toContain(CLIENT_IP)
        expect(JSON.stringify(mocks.logger.set.mock.calls))
          .not.toContain(created.token)
      })

    it('requires Turnstile from signed-out reporters when configured',
      async () => {
        const created = await createShare()

        configureTurnstile()

        await expect(reportShare(created.token, {})).resolves.toMatchObject({
          error: { status: 400, data: { code: 'turnstile_required' } },
        })

        mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
          'success': false,
          'error-codes': ['invalid-input-response'],
        })))

        await expect(reportShare(created.token, {
          turnstileToken: 'bad',
        })).resolves.toMatchObject({
          error: { status: 403, data: { code: 'turnstile_failed' } },
        })

        mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
          success: true,
        })))

        await expect(reportShare(created.token, {
          turnstileToken: 'good',
        })).resolves.toMatchObject({ result: { ok: true } })
        expect(await listReports()).toHaveLength(1)
      })

    it('refuses signed-out reports when Turnstile is enforced but missing',
      async () => {
        const created = await createShare()

        Object.assign(runtimeConfig, { turnstileEnforced: true })

        await expect(reportShare(created.token, {
          turnstileToken: 'any',
        })).resolves.toMatchObject({
          error: { status: 503, data: { code: 'turnstile_unavailable' } },
        })
        expect(mocks.fetch).not.toHaveBeenCalled()
        expect(await listReports()).toHaveLength(0)

        mocks.sessionUserId = viewerId

        await expect(reportShare(created.token, {}, {}))
          .resolves.toMatchObject({ result: { ok: true } })
      })

    it('lets a signed-in reporter skip Turnstile', async () => {
      const created = await createShare()

      configureTurnstile()
      mocks.sessionUserId = viewerId

      await expect(reportShare(created.token, {}, {}))
        .resolves.toMatchObject({ result: { ok: true } })
      expect(mocks.fetch).not.toHaveBeenCalled()
      expect((await listReports())[0]?.reporterUserId).toBe(viewerId)
    })

    it('accepts csam without a name or email and marks it urgent',
      async () => {
        const created = await createShare()

        await expect(reportShare(created.token, {
          reason: 'csam',
          reporterName: undefined,
          reporterEmail: undefined,
        })).resolves.toMatchObject({ result: { ok: true } })

        const [row] = await listReports()

        expect(row).toMatchObject({
          priority: 'urgent',
          reporterName: null,
          reporterEmail: null,
          receiptSentAt: null,
        })
        expect(sentEmails()).toEqual([
          expect.objectContaining({
            to: PRIVACY_EMAIL,
            subject: expect.stringMatching(/^\[URGENT\] /),
          }),
        ])
      })

    it('stores every copyright notice element', async () => {
      const created = await createShare()

      await expect(reportShare(created.token, {
        reason: 'copyright',
      })).resolves.toMatchObject({ error: { status: 400 } })

      await expect(reportShare(created.token, {
        reason: 'copyright',
        copyright: {
          work: 'My novel "The Gazebo", chapter 3',
          signature: 'Ann Reporter',
          ownerName: 'Gazebo Press',
          unauthorisedUse: true,
          authority: true,
        },
      })).resolves.toMatchObject({ result: { ok: true } })

      const [row] = await listReports()

      expect(row?.details).toContain(DETAILS)
      expect(row?.details).toContain('Signature: Ann Reporter')
      expect(row?.details).toContain('Work: My novel "The Gazebo", chapter 3')
      expect(row?.details).toContain('Rights owner: Gazebo Press')
      expect(row?.details).toContain('Location: the reported link')
    })

    it('rate limits reports per client IP', async () => {
      const created = await createShare()

      for (let index = 0; index < ARTIFACT_REPORT_RATE_LIMIT.max; index++) {
        await expect(reportShare(created.token, {}))
          .resolves.toMatchObject({ result: { ok: true } })
      }

      await expect(reportShare(created.token, {})).resolves.toMatchObject({
        error: { status: 429 },
      })
    })

    it('answers 404 for a revoked link and 410 after a takedown', async () => {
      const created = await createShare()

      testDb.sqlite.prepare('update artifact_shares set takedown_at = 1').run()

      await expect(reportShare(created.token, {})).resolves.toMatchObject({
        error: { status: 410 },
      })

      testDb.sqlite.prepare('update artifact_shares set revoked_at = 1').run()

      await expect(reportShare(created.token, {})).resolves.toMatchObject({
        error: { status: 404 },
      })
      expect(await listReports()).toHaveLength(0)
    })

    it('stores the version the link showed and ignores a client version',
      async () => {
        const pinned = await createShare({ pinnedVersion: 1 })

        await appendArtifactVersion({
          db: testDb.db,
          storage: mocks.storage,
          userId: ownerId,
          artifactId,
          content: '<p>v2</p>',
          createdBy: 'model',
        })

        const latest = await createShare()

        await reportShare(pinned.token, { version: 2 })
        await reportShare(latest.token, {})

        expect((await listReports()).map(row => row.reportedVersion))
          .toEqual([1, 2])
      })

    it('keys the IP limit by a hash and never stores the address in KV',
      async () => {
        const created = await createShare()

        await reportShare(created.token, {})

        const keys = [...mocks.kv.keys()]
        const ipKey = keys.find((key) => {
          return key.startsWith('artifact-report:rate-limit:ip:')
        })

        expect(ipKey).toMatch(/^artifact-report:rate-limit:ip:[0-9a-f]{64}$/)
        expect(JSON.stringify([...mocks.kv.entries()])).not.toContain(CLIENT_IP)
        expect(JSON.stringify([...mocks.kv.entries()]))
          .not.toContain('ann@example.test')
      })

    it('answers 429 with Retry-After 1 when the limiter cannot write',
      async () => {
        const created = await createShare()

        vi.stubGlobal('useKV', () => ({
          get: async () => null,
          put: async () => {
            throw new Error('KV write failed')
          },
          delete: async () => {},
        }))

        const response = await reportShare(created.token, {})

        expect(response.error).toMatchObject({ status: 429 })
        expect(response.event.res.headers.get('Retry-After')).toBe('1')
        expect(await listReports()).toHaveLength(0)
      })

    it('rejects line breaks and control characters in names', async () => {
      const created = await createShare()

      await expect(reportShare(created.token, {
        reporterName: 'Ann\nBcc: victim@example.test',
      })).resolves.toMatchObject({ error: { status: 400 } })
      await expect(reportShare(created.token, {
        reason: 'copyright',
        copyright: {
          work: 'My novel',
          signature: 'Ann\u0007Reporter',
          unauthorisedUse: true,
          authority: true,
        },
      })).resolves.toMatchObject({ error: { status: 400 } })
      await expect(reportShare(created.token, {
        reason: 'copyright',
        copyright: {
          work: 'My novel',
          signature: 'Ann Reporter',
          ownerName: 'Gazebo\r\nPress',
          unauthorisedUse: true,
          authority: true,
        },
      })).resolves.toMatchObject({ error: { status: 400 } })
      expect(await listReports()).toHaveLength(0)
    })

    it('redacts share links pasted into the details', async () => {
      const created = await createShare()
      const other = await createShare()

      await reportShare(created.token, {
        details: `Same as ${BASE_URL}/a/${other.token} and `
          + `/signin?next=%252Fa%252F${other.token} here.`,
      })

      const [row] = await listReports()

      expect(row?.details).toContain(`${BASE_URL}/a/[token]`)
      expect(row?.details).toContain('%252Fa%252F[token]')
      expect(row?.details).not.toContain(other.token)
      expect(emailArguments()).not.toContain(other.token)
    })

    it('names the content by reference only in the receipt', async () => {
      const created = await createShare()

      await reportShare(created.token, {})

      const receipt = sentEmails().find((email) => {
        return email.to === 'ann@example.test'
      })

      expect(receipt?.text).toContain(created.share.shareId)
      expect(emailArguments()).not.toContain('Bank quiz')
    })

    it('sends a signed-in reporter the receipt at the verified account email',
      async () => {
        const created = await createShare()
        const [viewer] = await testDb.db
          .select({ email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, viewerId))

        mocks.sessionUserId = viewerId

        await reportShare(created.token, {
          reporterEmail: 'someone-else@example.test',
        }, {})

        expect(sentEmails().map(email => email.to))
          .toEqual([PRIVACY_EMAIL, viewer!.email])
        expect((await listReports())[0]).toMatchObject({
          reporterEmail: 'someone-else@example.test',
          receiptSentAt: expect.any(Date),
        })

        testDb.sqlite.prepare(
          'update users set email_verified = 0 where id = ?',
        ).run(viewerId)
        mocks.sendEmail.mockClear()

        await reportShare(created.token, {}, {})

        expect(sentEmails().map(email => email.to)).toEqual([PRIVACY_EMAIL])
        expect((await listReports())[1]?.receiptSentAt).toBeNull()
      })

    it('caps receipts at 3 per address per day and still saves the report',
      async () => {
        const created = await createShare()

        for (let index = 0; index < 4; index++) {
          await expect(reportShare(created.token, {
            reporterEmail: 'Victim@Example.test',
          }, { 'cf-connecting-ip': `203.0.113.${index + 10}` }))
            .resolves.toMatchObject({ result: { ok: true } })
        }

        const receipts = sentEmails().filter((email) => {
          return email.to !== PRIVACY_EMAIL
        })

        expect(receipts).toHaveLength(3)
        expect(await listReports()).toHaveLength(4)
        expect((await listReports())[3]?.receiptSentAt).toBeNull()
      })

    it('skips the receipt when the recipient cap cannot be read',
      async () => {
        const created = await createShare()
        const kv = mocks.kv

        vi.stubGlobal('useKV', () => ({
          get: async (key: string) => {
            if (key.startsWith('artifact-report:receipt:')) {
              throw new Error('KV read failed')
            }

            return kv.get(key) ?? null
          },
          put: async (key: string, value: string) => {
            kv.set(key, value)
          },
          delete: async () => {},
        }))

        await expect(reportShare(created.token, {}))
          .resolves.toMatchObject({ result: { ok: true } })
        expect(sentEmails().map(email => email.to)).toEqual([PRIVACY_EMAIL])
        expect(await listReports()).toHaveLength(1)
      })

    it('keeps report rows when the artifact is deleted', async () => {
      const created = await createShare()

      await reportShare(created.token, {})
      await deleteArtifacts({
        db: testDb.db,
        storage: mocks.storage,
        userId: ownerId,
        artifactIds: [artifactId],
      })

      expect(await listReports()).toHaveLength(1)
    })
  })

  describe('admin', () => {
    async function seedReport() {
      const created = await createShare()

      await reportShare(created.token, {})

      const [report] = await listReports()

      mocks.sendEmail.mockClear()

      return { created, reportId: String(report!.id) }
    }

    async function seedChatReport() {
      const chat = await seedChat(testDb.db, ownerId)

      await seedMessage(testDb.db, chat.id, 'assistant', [
        textPart('Here'),
        {
          type: 'data-artifact',
          data: { artifactId, version: 1, kind: 'html', title: 'Bank quiz' },
        } as never,
      ], minutesBefore(5))
      await testDb.db.insert(schema.chatShares).values({
        chatId: chat.id,
        slug: CHAT_SHARE_SLUG,
      })

      const response = await call(handlers.chatReport, {
        params: { slug: CHAT_SHARE_SLUG, artifactId },
        headers: { 'cf-connecting-ip': CLIENT_IP },
        body: {
          reason: 'illegal',
          details: DETAILS,
          reporterName: 'Bo',
          reporterEmail: 'bo@example.test',
          goodFaith: true,
        },
      })

      expect(response.result).toEqual({ ok: true })

      const [report] = await listReports()

      mocks.sendEmail.mockClear()

      return String(report!.id)
    }

    it('refuses non-admins', async () => {
      mocks.sessionUserId = viewerId

      await expect(call(handlers.adminList)).resolves.toMatchObject({
        error: { status: 404 },
      })
    })

    it('lists open urgent reports first and shows the details', async () => {
      const created = await createShare()

      await reportShare(created.token, {})
      await reportShare(created.token, {
        reason: 'threat-to-life',
      })
      asAdmin()

      const listed = await call(handlers.adminList, { query: {} })

      expect(listed.result.total).toBe(2)
      expect(listed.result.items.map((item: { reason: string }) => {
        return item.reason
      })).toEqual(['threat-to-life', 'phishing'])
      expect(listed.result.items[0]).toMatchObject({
        artifactId,
        artifact: { id: artifactId, ownerUserId: ownerId, ownerEmail },
        share: { id: created.share.shareId, status: 'active' },
        chatShareId: null,
      })

      const detail = await call(handlers.adminDetail, {
        params: { id: String(listed.result.items[0].id) },
      })

      expect(detail.result).toMatchObject({
        details: DETAILS,
        locationUrl: created.url,
        previewVersion: 1,
      })

      const version = await call(handlers.adminVersion, {
        params: { id: artifactId, version: '1' },
      })

      expect(version.result).toMatchObject({ content: '<p>v1</p>' })
    })

    it('takes down one link from a report and emails both sides',
      async () => {
        const { created, reportId } = await seedReport()

        asAdmin()

        const response = await call(handlers.adminAction, {
          params: { id: reportId },
          body: { action: 'takedown', statement: STATEMENT, scope: 'share' },
        })

        expect(response.result).toEqual({
          reportId: Number(reportId),
          status: 'actioned',
          decision: 'restricted',
          newlyTakenDown: true,
        })
        await expect(readShare(created.token)).resolves.toMatchObject({
          error: { status: 410 },
        })

        const [report] = await listReports()

        expect(report).toMatchObject({
          status: 'actioned',
          decision: 'restricted',
          decisionStatement: STATEMENT,
          decidedAt: expect.any(Date),
          resolvedAt: expect.any(Date),
        })
        expect(await listAudit()).toEqual([
          expect.objectContaining({
            action: 'artifact.takedown',
            flag: 'artifacts',
            actorUserId: adminId,
            targetUserId: ownerId,
          }),
        ])
        expect(sentEmails().map(email => email.to))
          .toEqual([ownerEmail, 'ann@example.test'])
        expect(emailArguments()).not.toContain(created.token)
        expect(JSON.stringify(await listAudit())).not.toContain(created.token)

        expect(sentEmails()[0]?.text).toContain('Only that link is disabled')

        await expect(call(handlers.adminAction, {
          params: { id: reportId },
          body: { action: 'reject', statement: STATEMENT, scope: 'share' },
        })).resolves.toMatchObject({ error: { status: 409 } })
        expect(await listAudit()).toHaveLength(1)
        expect((await listReports())[0]?.status).toBe('actioned')
      })

    it('takes down the whole artifact from a shared-chat report',
      async () => {
        const reportId = await seedChatReport()
        const created = await createShare()

        asAdmin()

        await expect(call(handlers.adminAction, {
          params: { id: reportId },
          body: { action: 'takedown', statement: STATEMENT, scope: 'share' },
        })).resolves.toMatchObject({ error: { status: 400 } })

        const response = await call(handlers.adminAction, {
          params: { id: reportId },
          body: {
            action: 'takedown',
            statement: STATEMENT,
            scope: 'all-shares',
          },
        })

        expect(response.result).toMatchObject({ decision: 'removed' })
        await expect(readShare(created.token)).resolves.toMatchObject({
          error: { status: 410 },
        })
        expect(sentEmails().map(email => email.to))
          .toEqual([ownerEmail, 'bo@example.test'])
      })

    it('stores the shared-chat version and previews it for the admin',
      async () => {
        const chat = await seedChat(testDb.db, ownerId)

        await seedMessage(testDb.db, chat.id, 'assistant', [
          {
            type: 'data-artifact',
            data: { artifactId, version: 1, kind: 'html', title: 'Bank quiz' },
          } as never,
        ], minutesBefore(5))
        await testDb.db.insert(schema.chatShares).values({
          chatId: chat.id,
          slug: CHAT_SHARE_SLUG,
        })
        await appendArtifactVersion({
          db: testDb.db,
          storage: mocks.storage,
          userId: ownerId,
          artifactId,
          content: '<p>v2</p>',
          createdBy: 'model',
        })

        const report = (version: number) => {
          return call(handlers.chatReport, {
            params: { slug: CHAT_SHARE_SLUG, artifactId },
            headers: { 'cf-connecting-ip': CLIENT_IP },
            body: {
              reason: 'illegal',
              details: DETAILS,
              reporterName: 'Bo',
              reporterEmail: 'bo@example.test',
              goodFaith: true,
              version,
            },
          })
        }

        await expect(report(2)).resolves.toMatchObject({
          error: { status: 404 },
        })
        await expect(report(1)).resolves.toMatchObject({
          result: { ok: true },
        })

        const [row] = await listReports()

        expect(row?.reportedVersion).toBe(1)
        expect(emailArguments()).not.toContain('Bank quiz')

        asAdmin()

        await expect(call(handlers.adminDetail, {
          params: { id: String(row!.id) },
        })).resolves.toMatchObject({
          result: { reportedVersion: 1, currentVersion: 2, previewVersion: 1 },
        })
      })

    it('reopens the report when the takedown batch fails', async () => {
      const { created, reportId } = await seedReport()

      asAdmin()

      const batch = vi.spyOn(testDb.db, 'batch')
        .mockRejectedValueOnce(new Error('D1 batch failed'))
      const failed = await call(handlers.adminAction, {
        params: { id: reportId },
        body: { action: 'takedown', statement: STATEMENT, scope: 'share' },
      })

      batch.mockRestore()

      expect(failed.error?.message).toBe('D1 batch failed')
      expect((await listReports())[0]).toMatchObject({
        status: 'open',
        decision: null,
        decisionStatement: null,
        decidedAt: null,
        resolvedAt: null,
      })
      expect(await listAudit()).toHaveLength(0)
      await expect(readShare(created.token)).resolves.toMatchObject({
        result: { version: 1 },
      })
      expect(mocks.sendEmail).not.toHaveBeenCalled()

      await expect(call(handlers.adminAction, {
        params: { id: reportId },
        body: { action: 'takedown', statement: STATEMENT, scope: 'share' },
      })).resolves.toMatchObject({ result: { newlyTakenDown: true } })
    })

    it('reopens the report when the reject audit row fails', async () => {
      const { reportId } = await seedReport()

      asAdmin()

      const insert = vi.spyOn(testDb.db, 'insert')
        .mockImplementationOnce(() => {
          throw new Error('Audit insert failed')
        })
      const failed = await call(handlers.adminAction, {
        params: { id: reportId },
        body: { action: 'reject', statement: STATEMENT, scope: 'share' },
      })

      insert.mockRestore()

      expect(failed.error?.message).toBe('Audit insert failed')
      expect((await listReports())[0]).toMatchObject({
        status: 'open',
        decision: null,
        decidedAt: null,
      })
      expect(mocks.sendEmail).not.toHaveBeenCalled()
    })

    it('lets only one of two concurrent decisions act', async () => {
      const { reportId } = await seedReport()

      asAdmin()

      const decide = (action: string) => {
        return call(handlers.adminAction, {
          params: { id: reportId },
          body: { action, statement: STATEMENT, scope: 'share' },
        })
      }
      const results = await Promise.all([decide('takedown'), decide('reject')])

      expect(results.filter(response => response.error)).toEqual([
        expect.objectContaining({ error: expect.objectContaining({
          status: 409,
        }) }),
      ])
      expect(await listAudit()).toHaveLength(1)
    })

    it('rejects a report and only tells the reporter', async () => {
      const { created, reportId } = await seedReport()

      asAdmin()

      await expect(call(handlers.adminAction, {
        params: { id: reportId },
        body: { action: 'reject', statement: STATEMENT, scope: 'share' },
      })).resolves.toMatchObject({
        result: { status: 'rejected', decision: 'no-action' },
      })
      await expect(readShare(created.token)).resolves.toMatchObject({
        result: { version: 1 },
      })
      expect(sentEmails().map(email => email.to))
        .toEqual(['ann@example.test'])
      expect(await listAudit()).toEqual([
        expect.objectContaining({ action: 'artifact-report.reject' }),
      ])
    })

    it('takes down directly by link, token, artifact id and user',
      async () => {
        const byUrl = await createShare()
        const byToken = await createShare()

        asAdmin()

        const takeDown = (body: Record<string, unknown>) => {
          return call(handlers.adminTakedown, {
            body: { statement: STATEMENT, ...body },
          })
        }

        await expect(takeDown({ target: byUrl.url, scope: 'share' }))
          .resolves.toMatchObject({
            result: { scope: 'share', takenDown: 1, shareId: byUrl.share.shareId },
          })
        await expect(readShare(byUrl.token)).resolves.toMatchObject({
          error: { status: 410 },
        })
        await expect(readShare(byToken.token)).resolves.toMatchObject({
          result: { version: 1 },
        })
        await expect(takeDown({ target: byToken.token, scope: 'share' }))
          .resolves.toMatchObject({ result: { takenDown: 1 } })
        await expect(takeDown({
          target: artifactId,
          scope: 'artifact',
          legalHold: true,
        })).resolves.toMatchObject({
          result: {
            scope: 'artifact',
            takenDown: 1,
            artifactIds: [artifactId],
            legalHoldUntil: expect.any(String),
          },
        })

        const [artifact] = await testDb.db.select().from(schema.artifacts)

        expect(artifact?.takedownAt).toBeInstanceOf(Date)
        expect(artifact?.legalHoldUntil).toBeInstanceOf(Date)

        const second = await createArtifact({
          db: testDb.db,
          storage: mocks.storage,
          userId: ownerId,
          kind: 'svg',
          title: 'Second',
          content: '<svg/>',
          createdVia: 'chat',
          createdBy: 'model',
        })

        await expect(takeDown({ target: ownerEmail, scope: 'user' }))
          .resolves.toMatchObject({
            result: {
              scope: 'user',
              takenDown: 1,
              alreadyTakenDown: 1,
              ownerUserId: ownerId,
            },
          })
        await expect(takeDown({ target: String(ownerId), scope: 'user' }))
          .resolves.toMatchObject({ result: { takenDown: 0 } })
        await expect(takeDown({ target: 'nobody', scope: 'artifact' }))
          .resolves.toMatchObject({ error: { status: 404 } })

        expect((await listAudit()).map(entry => entry.action)).toEqual([
          'artifact.takedown',
          'artifact.takedown',
          'artifact.takedown',
          'artifact.takedown',
          'grant.set',
          'artifact.takedown',
          'grant.set',
        ])
        expect(await testDb.db.select().from(schema.featureGrants))
          .toEqual([
            expect.objectContaining({
              userId: ownerId,
              flag: 'artifacts.share',
              effect: 'deny',
              expiresAt: null,
              grantedBy: adminId,
            }),
          ])
        expect(sentEmails().at(-1)?.text)
          .toContain('Link sharing is also turned off for your account')
        expect(JSON.stringify(await listAudit())).not.toContain(byUrl.token)
        expect(JSON.stringify(mocks.logger.set.mock.calls))
          .not.toContain(byToken.token)
        expect(sentEmails().every(email => email.to === ownerEmail))
          .toBe(true)
        expect(sentEmails().some((email) => {
          return email.text.includes(second.artifactId)
        })).toBe(true)
      })

    it('restores a share and an artifact without email', async () => {
      const created = await createShare()

      asAdmin()
      await call(handlers.adminTakedown, {
        body: { target: created.token, statement: STATEMENT, scope: 'share' },
      })
      await call(handlers.adminTakedown, {
        body: { target: artifactId, statement: STATEMENT, scope: 'artifact' },
      })
      mocks.sendEmail.mockClear()

      await expect(call(handlers.adminRestore, {
        body: { shareId: created.share.shareId },
      })).resolves.toMatchObject({ result: { restored: true } })
      await expect(readShare(created.token)).resolves.toMatchObject({
        error: { status: 410 },
      })
      await expect(call(handlers.adminRestore, {
        body: { artifactId },
      })).resolves.toMatchObject({ result: { restored: true } })
      await expect(readShare(created.token)).resolves.toMatchObject({
        result: { version: 1 },
      })
      await expect(call(handlers.adminRestore, {
        body: { artifactId },
      })).resolves.toMatchObject({ error: { status: 409 } })
      await expect(call(handlers.adminRestore, {
        body: { artifactId, shareId: created.share.shareId },
      })).resolves.toMatchObject({ error: { status: 400 } })

      expect(mocks.sendEmail).not.toHaveBeenCalled()
      expect((await listAudit()).filter((entry) => {
        return entry.action === 'artifact.restore'
      })).toHaveLength(2)
    })

    it('writes one restore audit row when two restores race', async () => {
      const created = await createShare()

      asAdmin()
      await call(handlers.adminTakedown, {
        body: { target: created.token, statement: STATEMENT, scope: 'share' },
      })

      const restore = () => {
        return call(handlers.adminRestore, {
          body: { shareId: created.share.shareId },
        })
      }
      const deletes = vi.spyOn(testDb.db, 'delete')
      const results = await Promise.all([restore(), restore()])

      expect(results.map(response => response.error?.status ?? 200).sort())
        .toEqual([200, 409])
      expect(deletes).toHaveBeenCalledTimes(1)
      expect((await listAudit()).filter((entry) => {
        return entry.action === 'artifact.restore'
      })).toHaveLength(1)
    })
  })
})
