import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  CURRENT_CONSENT_VERSION,
  getEffectiveConsentVersion,
  getLegalConsentStatus,
  isEffectiveConsentVersion,
  readLegalConsent,
  recordLegalConsent,
} from '~~/server/utils/legal/consent'
import {
  APPROVED_CONSENT_VERSION_CACHE_KEY,
  APPROVED_CONSENT_VERSION_MEMO_TTL_MS,
  BASELINE_APPROVED_CONSENT_VERSION,
  compareConsentVersions,
  getCachedApprovedConsentVersion,
  isApprovedConsentVersionUnavailable,
  loadApprovedConsentVersion,
  rememberApprovedConsentVersion,
  resetApprovedConsentVersionMemo,
  resolveEffectiveConsentVersion,
} from '~~/server/utils/legal/consent-version'
import {
  createMemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const GRANTED_AT = new Date('2026-11-01T00:00:00.000Z')

function recordOn(version: string) {
  return {
    termsAcceptedAt: GRANTED_AT,
    termsVersion: version,
    ageConfirmedAt: GRANTED_AT,
    sensitiveContentConsentAt: GRANTED_AT,
    sensitiveContentConsentVersion: version,
    sensitiveContentConsentWithdrawnAt: null,
    providerTransferConsents: null,
  }
}

function createKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }
}

describe('consent version gate', () => {
  let testDb: MemoryExtractionTestDb

  beforeEach(() => {
    resetApprovedConsentVersionMemo()
    testDb = createMemoryExtractionTestDb()
  })

  afterEach(() => {
    testDb.close()
    resetApprovedConsentVersionMemo()
    vi.unstubAllGlobals()
  })

  describe('compareConsentVersions', () => {
    it('orders by month, then suffix length, then letters', () => {
      expect(compareConsentVersions('2026-11-a', '2026-11-a')).toBe(0)
      expect(compareConsentVersions('2026-11-a', '2026-11-b')).toBe(-1)
      expect(compareConsentVersions('2026-12-a', '2026-11-z')).toBe(1)
      expect(compareConsentVersions('2026-11-z', '2026-11-aa')).toBe(-1)
      expect(compareConsentVersions('2027-01-a', '2026-12-z')).toBe(1)
    })
  })

  describe('resolveEffectiveConsentVersion', () => {
    it('keeps the approved version when code is bumped without approval',
      () => {
        expect(resolveEffectiveConsentVersion('2026-12-a', null))
          .toBe(BASELINE_APPROVED_CONSENT_VERSION)
        expect(resolveEffectiveConsentVersion('2026-12-a', '2026-11-a'))
          .toBe('2026-11-a')
      })

    it('uses the code version once the owner approved it', () => {
      expect(resolveEffectiveConsentVersion('2026-12-a', '2026-12-a'))
        .toBe('2026-12-a')
    })

    it('uses the code version when code is behind the approval', () => {
      expect(resolveEffectiveConsentVersion('2026-11-a', '2026-12-a'))
        .toBe('2026-11-a')
    })

    it('treats a malformed approval as the baseline', () => {
      expect(resolveEffectiveConsentVersion('2026-12-a', 'latest'))
        .toBe(BASELINE_APPROVED_CONSENT_VERSION)
    })
  })

  it('keeps the version users accepted before owner approval existed', () => {
    expect(BASELINE_APPROVED_CONSENT_VERSION).toBe('2026-11-a')
    expect(CURRENT_CONSENT_VERSION).toBe(BASELINE_APPROVED_CONSENT_VERSION)
    expect(getEffectiveConsentVersion()).toBe('2026-11-a')
    expect(getLegalConsentStatus(recordOn('2026-11-a'))).toBe('current')
  })

  it('compares stored consent with the effective version', () => {
    rememberApprovedConsentVersion('2026-10-a')

    expect(getEffectiveConsentVersion()).toBe('2026-10-a')
    expect(getLegalConsentStatus(recordOn('2026-10-a'))).toBe('current')
    expect(getLegalConsentStatus(recordOn(CURRENT_CONSENT_VERSION)))
      .toBe('outdated')
  })

  describe('loadApprovedConsentVersion', () => {
    it('falls back to the baseline when nothing was approved', async () => {
      const kv = createKv()

      await expect(loadApprovedConsentVersion({ db: testDb.db, kv }))
        .resolves.toBe(BASELINE_APPROVED_CONSENT_VERSION)
      expect(kv.put).toHaveBeenCalledWith(
        APPROVED_CONSENT_VERSION_CACHE_KEY,
        BASELINE_APPROVED_CONSENT_VERSION,
        expect.objectContaining({ expirationTtl: expect.any(Number) }),
      )
    })

    it('reads the newest approval from D1 and caches it in KV', async () => {
      const kv = createKv()

      await testDb.db.insert(schema.legalConsentVersionApprovals).values([
        {
          version: '2026-11-a',
          consentTextSha256: 'a',
          approvedAt: GRANTED_AT,
        },
        {
          version: '2026-12-a',
          consentTextSha256: 'b',
          approvedAt: GRANTED_AT,
        },
      ])

      await expect(loadApprovedConsentVersion({ db: testDb.db, kv }))
        .resolves.toBe('2026-12-a')
      expect(kv.store.get(APPROVED_CONSENT_VERSION_CACHE_KEY))
        .toBe('2026-12-a')
      expect(getCachedApprovedConsentVersion()).toBe('2026-12-a')
    })

    it('prefers KV and refreshes at most once a minute', async () => {
      const kv = createKv({
        [APPROVED_CONSENT_VERSION_CACHE_KEY]: '2026-12-a',
      })

      await loadApprovedConsentVersion({ db: testDb.db, kv, now: 1_000 })
      kv.store.set(APPROVED_CONSENT_VERSION_CACHE_KEY, '2027-01-a')
      await loadApprovedConsentVersion({ db: testDb.db, kv, now: 2_000 })

      expect(kv.get).toHaveBeenCalledTimes(1)
      expect(getCachedApprovedConsentVersion()).toBe('2026-12-a')

      await loadApprovedConsentVersion({
        db: testDb.db,
        kv,
        now: 1_000 + APPROVED_CONSENT_VERSION_MEMO_TTL_MS,
      })

      expect(getCachedApprovedConsentVersion()).toBe('2027-01-a')
    })

    it('keeps the last known version when KV and D1 both fail', async () => {
      const kv = createKv()

      kv.get.mockRejectedValue(new Error('kv down'))
      rememberApprovedConsentVersion('2026-12-a', 0)
      testDb.sqlite.exec('DROP TABLE legal_consent_version_approvals')

      await expect(loadApprovedConsentVersion({
        db: testDb.db,
        kv,
        now: APPROVED_CONSENT_VERSION_MEMO_TTL_MS * 2,
      })).resolves.toBe('2026-12-a')
    })

    it('returns null without a cached value when KV and D1 both fail',
      async () => {
        const kv = createKv()

        kv.get.mockRejectedValue(new Error('kv down'))
        testDb.sqlite.exec('DROP TABLE legal_consent_version_approvals')

        await expect(loadApprovedConsentVersion({ db: testDb.db, kv }))
          .resolves.toBeNull()
        expect(isApprovedConsentVersionUnavailable()).toBe(true)
        expect(getLegalConsentStatus(recordOn('2026-11-a'))).toBe('current')
        expect(isEffectiveConsentVersion('2026-10-a')).toBe(false)
        expect(isEffectiveConsentVersion('2027-01-a')).toBe(false)
      })

    it('refuses to record consent while the version is unavailable',
      async () => {
        const kv = createKv()

        kv.get.mockRejectedValue(new Error('kv down'))
        vi.stubGlobal('useKV', () => kv)
        testDb.sqlite.exec('DROP TABLE legal_consent_version_approvals')

        await expect(recordLegalConsent(1, testDb.db))
          .rejects.toMatchObject({ status: 503 })
      })

    it('loads the approved version before reading a user consent', async () => {
      const kv = createKv({
        [APPROVED_CONSENT_VERSION_CACHE_KEY]: '2026-10-a',
      })

      vi.stubGlobal('useKV', () => kv)

      await readLegalConsent(1, testDb.db)

      expect(kv.get).toHaveBeenCalledWith(APPROVED_CONSENT_VERSION_CACHE_KEY)
      expect(getEffectiveConsentVersion()).toBe('2026-10-a')
    })
  })
})
