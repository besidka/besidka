import { vi } from 'vitest'

type ConsentModule = typeof import('~~/server/utils/legal/consent')
type LegalConsentRecord = import('~~/server/utils/legal/consent').LegalConsentRecord

const actual = await vi.importActual<ConsentModule>(
  '~~/server/utils/legal/consent',
)

const GRANTED_AT = new Date('2026-10-01T00:00:00.000Z')

function grantedRecord(): LegalConsentRecord {
  const transferConsent = {
    consentedAt: GRANTED_AT.getTime(),
    withdrawnAt: null,
  }

  return {
    termsAcceptedAt: GRANTED_AT,
    termsVersion: actual.CURRENT_CONSENT_VERSION,
    ageConfirmedAt: GRANTED_AT,
    sensitiveContentConsentAt: GRANTED_AT,
    sensitiveContentConsentVersion: actual.CURRENT_CONSENT_VERSION,
    sensitiveContentConsentWithdrawnAt: null,
    providerTransferConsents: {
      deepseek: transferConsent,
      moonshotai: transferConsent,
      qwen: transferConsent,
    },
  }
}

/**
 * Module mock for specs that stub `useDb()` with hand-built query objects:
 * every user has a current consent and every transfer consent, while the
 * pure predicates stay real. Register with
 * `vi.mock('~~/server/utils/legal/consent', () => import(path))`. It must
 * not import anything that imports the consent module back, or the mocked
 * module waits on itself.
 */
export const CURRENT_CONSENT_VERSION = actual.CURRENT_CONSENT_VERSION
export const legalConsentColumns = actual.legalConsentColumns
export const getLegalConsentStatus = actual.getLegalConsentStatus
export const hasCurrentLegalConsent = actual.hasCurrentLegalConsent
export const isTransferConsentGranted = actual.isTransferConsentGranted
export const hasProviderTransferConsent = actual.hasProviderTransferConsent
export const withoutUnconsentedTransferProviders
  = actual.withoutUnconsentedTransferProviders
export const currentLegalConsentCondition = actual.currentLegalConsentCondition
export const assertLegalConsent = actual.assertLegalConsent
export const assertProviderTransferConsent
  = actual.assertProviderTransferConsent
export const toLegalConsentState = actual.toLegalConsentState

export const readLegalConsent = vi.fn(async () => grantedRecord())
export const requireLegalConsent = vi.fn(async () => grantedRecord())
export const hasUserLegalConsent = vi.fn(async () => true)
export const recordLegalConsent = vi.fn(async () => grantedRecord())
export const withdrawLegalConsent = vi.fn(async () => grantedRecord())
export const recordProviderTransferConsent = vi.fn(async () => {
  return grantedRecord()
})
export const withdrawProviderTransferConsent = vi.fn(async () => {
  return grantedRecord()
})
