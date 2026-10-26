import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import type { LegalConsentRecord } from '~~/server/utils/legal/consent'
import {
  CURRENT_CONSENT_VERSION,
  assertLegalConsent,
  assertModelTransferConsent,
  assertProviderTransferConsent,
  currentLegalConsentCondition,
  getLegalConsentStatus,
  hasCurrentLegalConsent,
  hasModelTransferConsent,
  hasProviderTransferConsent,
  readLegalConsent,
  recordLegalConsent,
  recordProviderTransferConsent,
  toLegalConsentState,
  withdrawLegalConsent,
  withdrawProviderTransferConsent,
  withoutUnconsentedTransferProviders,
} from '~~/server/utils/legal/consent'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import { seedBackfillJob } from '../../../../setup/helpers/memory-backfill-db'
import {
  createGrantedLegalConsentRecord,
} from '../../../../setup/fixtures/legal-consent'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const GRANTED_AT = new Date('2026-11-02T10:00:00.000Z')
const LATER = new Date('2026-11-03T10:00:00.000Z')

function record(
  overrides: Partial<LegalConsentRecord> = {},
): LegalConsentRecord {
  return createGrantedLegalConsentRecord({
    termsAcceptedAt: GRANTED_AT,
    ageConfirmedAt: GRANTED_AT,
    sensitiveContentConsentAt: GRANTED_AT,
    ...overrides,
  })
}

describe('legal consent predicate', () => {
  it('uses the 2026-11-a consent version', () => {
    expect(CURRENT_CONSENT_VERSION).toBe('2026-11-a')
  })

  it('is missing when nothing was recorded', () => {
    expect(getLegalConsentStatus(null)).toBe('missing')
    expect(getLegalConsentStatus(undefined)).toBe('missing')
    expect(getLegalConsentStatus(record({
      sensitiveContentConsentAt: null,
    }))).toBe('missing')
  })

  it('is current for the current version with terms and age', () => {
    expect(getLegalConsentStatus(record())).toBe('current')
    expect(hasCurrentLegalConsent(record())).toBe(true)
  })

  it('is withdrawn when the withdrawal is not older than the grant', () => {
    expect(getLegalConsentStatus(record({
      sensitiveContentConsentWithdrawnAt: LATER,
    }))).toBe('withdrawn')
    expect(getLegalConsentStatus(record({
      sensitiveContentConsentWithdrawnAt: GRANTED_AT,
    }))).toBe('withdrawn')
  })

  it('is current again after a re-consent that follows a withdrawal', () => {
    expect(getLegalConsentStatus(record({
      sensitiveContentConsentAt: LATER,
      sensitiveContentConsentWithdrawnAt: GRANTED_AT,
    }))).toBe('current')
  })

  it('is outdated for an older consent or terms version', () => {
    expect(getLegalConsentStatus(record({
      sensitiveContentConsentVersion: '2026-10-a',
    }))).toBe('outdated')
    expect(getLegalConsentStatus(record({
      termsVersion: '2026-10-a',
    }))).toBe('outdated')
  })

  it('is outdated without the terms acceptance or the age confirmation',
    () => {
      expect(getLegalConsentStatus(record({
        termsAcceptedAt: null,
      }))).toBe('outdated')
      expect(getLegalConsentStatus(record({
        ageConfirmedAt: null,
      }))).toBe('outdated')
    })

  it('refuses with a 403 that explains why and how to fix it', () => {
    expect(() => assertLegalConsent(null)).toThrow(expect.objectContaining({
      status: 403,
      why: expect.stringContaining('not yet accepted'),
      fix: expect.stringContaining('Privacy & consent'),
    }))
    expect(() => assertLegalConsent(record({
      sensitiveContentConsentWithdrawnAt: LATER,
    }))).toThrow(expect.objectContaining({
      status: 403,
      why: expect.stringContaining('withdrew'),
    }))
    expect(() => assertLegalConsent(record({
      sensitiveContentConsentVersion: '2026-10-a',
    }))).toThrow(expect.objectContaining({
      status: 403,
      why: expect.stringContaining('changed'),
    }))
    expect(() => assertLegalConsent(record())).not.toThrow()
  })
})

describe('provider transfer consent', () => {
  const noTransfers = record({ providerTransferConsents: null })

  it('needs no transfer consent outside DeepSeek, Moonshot AI and Qwen',
    () => {
      for (const providerId of ['openai', 'anthropic', 'google', 'xai']) {
        expect(hasProviderTransferConsent(noTransfers, providerId)).toBe(true)
      }
    })

  it.each(['deepseek', 'moonshotai', 'qwen'])(
    'needs a transfer consent for %s',
    (providerId) => {
      expect(hasProviderTransferConsent(noTransfers, providerId)).toBe(false)
      expect(hasProviderTransferConsent(record(), providerId)).toBe(true)
    },
  )

  it('treats a withdrawn transfer consent as missing', () => {
    const withdrawn = record({
      providerTransferConsents: {
        qwen: {
          consentedAt: GRANTED_AT.getTime(),
          withdrawnAt: LATER.getTime(),
        },
      },
    })

    expect(hasProviderTransferConsent(withdrawn, 'qwen')).toBe(false)
  })

  it('names the country when it refuses a send', () => {
    expect(() => {
      assertProviderTransferConsent(noTransfers, 'deepseek')
    }).toThrow(expect.objectContaining({
      status: 403,
      why: expect.stringContaining('China'),
    }))
    expect(() => {
      assertProviderTransferConsent(noTransfers, 'moonshotai')
    }).toThrow(expect.objectContaining({
      why: expect.stringContaining('Singapore'),
    }))
    expect(() => {
      assertProviderTransferConsent(noTransfers, 'openai')
    }).not.toThrow()
  })

  it('drops unconsented transfer providers from a key set', () => {
    const keys = new Set(['openai', 'deepseek', 'qwen', 'vercel'])

    expect([...withoutUnconsentedTransferProviders(keys, noTransfers)])
      .toEqual(['openai', 'vercel'])
    expect([...withoutUnconsentedTransferProviders(keys, record())])
      .toEqual(['openai', 'deepseek', 'qwen', 'vercel'])
  })
})

describe('gateway models of transfer-consent vendors', () => {
  const noTransfers = record({ providerTransferConsents: null })

  it.each([
    ['openrouter', 'deepseek/deepseek-chat', 'deepseek'],
    ['vercel', 'moonshotai/kimi-k2', 'moonshotai'],
    ['vercel', 'alibaba/qwen3-max', 'qwen'],
    ['openrouter', 'qwen/qwen3-coder', 'qwen'],
    ['cloudflare', 'deepseek/deepseek-chat', 'deepseek'],
  ])('needs the %s transfer consent for %s', (gatewayId, modelId, provider) => {
    expect(hasModelTransferConsent(noTransfers, { gatewayId, modelId }))
      .toBe(false)
    expect(hasModelTransferConsent(record(), { gatewayId, modelId }))
      .toBe(true)
    expect(() => {
      assertModelTransferConsent(noTransfers, { gatewayId, modelId })
    }).toThrow(expect.objectContaining({
      status: 403,
      code: 'TRANSFER_CONSENT_REQUIRED',
      data: expect.objectContaining({ provider }),
    }))
  })

  it.each([
    ['cloudflare', '@cf/qwen/qwen3-30b-a3b-fp8'],
    ['cloudflare', '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'],
    ['openrouter', 'anthropic/claude-haiku-5-5'],
    ['vercel', 'openai/gpt-5-mini'],
  ])('needs none for the %s model %s', (gatewayId, modelId) => {
    expect(hasModelTransferConsent(noTransfers, { gatewayId, modelId }))
      .toBe(true)
  })
})

describe('legal consent storage', () => {
  let testDb: MemoryExtractionTestDb

  beforeEach(() => {
    testDb = createMemoryExtractionTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  it('records consent for an OAuth user who has no settings row yet',
    async () => {
      const userId = await seedUser(testDb.db, null)

      expect(getLegalConsentStatus(await readLegalConsent(userId, testDb.db)))
        .toBe('missing')

      const saved = await recordLegalConsent(userId, testDb.db, GRANTED_AT)

      expect(saved).toMatchObject({
        termsAcceptedAt: GRANTED_AT,
        termsVersion: CURRENT_CONSENT_VERSION,
        ageConfirmedAt: GRANTED_AT,
        sensitiveContentConsentAt: GRANTED_AT,
        sensitiveContentConsentVersion: CURRENT_CONSENT_VERSION,
      })
      expect(getLegalConsentStatus(saved)).toBe('current')
    })

  it('keeps other settings when it records consent', async () => {
    const userId = await seedUser(testDb.db, {
      memoryEnabled: false,
      sensitiveContentConsentAt: null,
    })

    await recordLegalConsent(userId, testDb.db, GRANTED_AT)

    const settings = await testDb.db.query.userSettings.findFirst({
      where: { userId },
    })

    expect(settings?.memoryEnabled).toBe(false)
  })

  it('withdraws, cancels a running backfill and keeps the history',
    async () => {
      const userId = await seedUser(testDb.db, null)

      await recordLegalConsent(userId, testDb.db, GRANTED_AT)

      const job = await seedBackfillJob(testDb.db, userId)
      const withdrawn = await withdrawLegalConsent(userId, testDb.db, LATER)
      const cancelledJob = await testDb.db.query.memoryBackfillJobs
        .findFirst({ where: { id: job.id } })

      expect(getLegalConsentStatus(withdrawn)).toBe('withdrawn')
      expect(withdrawn.sensitiveContentConsentAt).toEqual(GRANTED_AT)
      expect(cancelledJob?.status).toBe('cancelled')

      const reConsentedAt = new Date(LATER.getTime() + 60_000)
      const reConsented = await recordLegalConsent(
        userId,
        testDb.db,
        reConsentedAt,
      )

      expect(getLegalConsentStatus(reConsented)).toBe('current')
      expect(reConsented.sensitiveContentConsentWithdrawnAt).toEqual(LATER)
    })

  it('re-consents within the same second as a withdrawal', async () => {
    const userId = await seedUser(testDb.db, null)

    await recordLegalConsent(userId, testDb.db, GRANTED_AT)
    await withdrawLegalConsent(userId, testDb.db, LATER)

    const reConsented = await recordLegalConsent(userId, testDb.db, LATER)

    expect(getLegalConsentStatus(reConsented)).toBe('current')
  })

  it('stays current when a re-consent follows a withdrawal in the same '
    + 'second at a later millisecond', async () => {
    const userId = await seedUser(testDb.db, null)

    await recordLegalConsent(userId, testDb.db, GRANTED_AT)
    await withdrawLegalConsent(
      userId,
      testDb.db,
      new Date('2026-11-03T10:00:00.200Z'),
    )

    const reConsented = await recordLegalConsent(
      userId,
      testDb.db,
      new Date('2026-11-03T10:00:00.700Z'),
    )

    expect(getLegalConsentStatus(reConsented)).toBe('current')
    expect(reConsented.sensitiveContentConsentAt)
      .toEqual(new Date('2026-11-03T10:00:00.000Z'))
  })

  it('records and withdraws a transfer consent per provider', async () => {
    const userId = await seedUser(testDb.db, null)
    const granted = await recordProviderTransferConsent(
      userId,
      'deepseek',
      testDb.db,
      GRANTED_AT,
    )

    expect(hasProviderTransferConsent(granted, 'deepseek')).toBe(true)
    expect(hasProviderTransferConsent(granted, 'qwen')).toBe(false)

    const withdrawn = await withdrawProviderTransferConsent(
      userId,
      'deepseek',
      testDb.db,
      LATER,
    )

    expect(hasProviderTransferConsent(withdrawn, 'deepseek')).toBe(false)
    expect(withdrawn.providerTransferConsents?.deepseek).toEqual({
      consentedAt: GRANTED_AT.getTime(),
      withdrawnAt: LATER.getTime(),
    })
  })

  it('selects only users with a current consent in SQL', async () => {
    const current = await seedUser(testDb.db, {})
    const withdrawn = await seedUser(testDb.db, {
      sensitiveContentConsentWithdrawnAt: new Date('2027-01-01T00:00:00Z'),
    })
    const reConsented = await seedUser(testDb.db, {
      sensitiveContentConsentWithdrawnAt: new Date('2020-01-01T00:00:00Z'),
    })
    const outdated = await seedUser(testDb.db, {
      sensitiveContentConsentVersion: '2026-10-a',
    })
    const missing = await seedUser(testDb.db, {
      sensitiveContentConsentAt: null,
    })
    const rows = await testDb.db
      .select({ userId: schema.userSettings.userId })
      .from(schema.userSettings)
      .where(currentLegalConsentCondition())
    const userIds = rows.map(row => row.userId)

    expect(userIds).toContain(current)
    expect(userIds).toContain(reConsented)
    expect(userIds).not.toContain(withdrawn)
    expect(userIds).not.toContain(outdated)
    expect(userIds).not.toContain(missing)
  })

  it('exposes the state the settings page shows', async () => {
    const userId = await seedUser(testDb.db, null)

    await recordLegalConsent(userId, testDb.db, GRANTED_AT)
    await recordProviderTransferConsent(userId, 'qwen', testDb.db, GRANTED_AT)

    const state = toLegalConsentState(
      await readLegalConsent(userId, testDb.db),
    )

    expect(state).toMatchObject({
      currentVersion: CURRENT_CONSENT_VERSION,
      status: 'current',
      sensitiveContentConsentAt: GRANTED_AT.toISOString(),
    })
    expect(state.transfers).toEqual([
      expect.objectContaining({
        providerId: 'deepseek',
        country: 'China',
        isGranted: false,
      }),
      expect.objectContaining({
        providerId: 'moonshotai',
        country: 'Singapore',
        isGranted: false,
      }),
      expect.objectContaining({
        providerId: 'qwen',
        country: 'Singapore',
        isGranted: true,
        consentedAt: GRANTED_AT.toISOString(),
      }),
    ])
  })

  it('stores nothing for another user', async () => {
    const userId = await seedUser(testDb.db, null)
    const otherUserId = await seedUser(testDb.db, null)

    await recordLegalConsent(userId, testDb.db, GRANTED_AT)

    const other = await testDb.db.query.userSettings.findFirst({
      where: { userId: otherUserId },
    })
    const rows = await testDb.db.select().from(schema.userSettings)
      .where(eq(schema.userSettings.userId, otherUserId))

    expect(other).toBeUndefined()
    expect(rows).toHaveLength(0)
  })
})
