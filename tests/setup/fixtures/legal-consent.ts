import type { LegalConsentRecord } from '~~/server/utils/legal/consent'
import { CURRENT_CONSENT_VERSION } from '~~/server/utils/legal/consent'

export const LEGAL_CONSENT_GRANTED_AT = new Date('2026-10-01T00:00:00.000Z')

export const grantedLegalConsentValues = {
  termsAcceptedAt: LEGAL_CONSENT_GRANTED_AT,
  termsVersion: CURRENT_CONSENT_VERSION,
  ageConfirmedAt: LEGAL_CONSENT_GRANTED_AT,
  sensitiveContentConsentAt: LEGAL_CONSENT_GRANTED_AT,
  sensitiveContentConsentVersion: CURRENT_CONSENT_VERSION,
  sensitiveContentConsentWithdrawnAt: null,
}

export function createGrantedLegalConsentRecord(
  overrides: Partial<LegalConsentRecord> = {},
): LegalConsentRecord {
  return {
    ...grantedLegalConsentValues,
    providerTransferConsents: {
      deepseek: {
        consentedAt: LEGAL_CONSENT_GRANTED_AT.getTime(),
        withdrawnAt: null,
      },
      moonshotai: {
        consentedAt: LEGAL_CONSENT_GRANTED_AT.getTime(),
        withdrawnAt: null,
      },
      qwen: {
        consentedAt: LEGAL_CONSENT_GRANTED_AT.getTime(),
        withdrawnAt: null,
      },
      zai: {
        consentedAt: LEGAL_CONSENT_GRANTED_AT.getTime(),
        withdrawnAt: null,
      },
      minimax: {
        consentedAt: LEGAL_CONSENT_GRANTED_AT.getTime(),
        withdrawnAt: null,
      },
      tencent: {
        consentedAt: LEGAL_CONSENT_GRANTED_AT.getTime(),
        withdrawnAt: null,
      },
      bytedance: {
        consentedAt: LEGAL_CONSENT_GRANTED_AT.getTime(),
        withdrawnAt: null,
      },
      xiaomi: {
        consentedAt: LEGAL_CONSENT_GRANTED_AT.getTime(),
        withdrawnAt: null,
      },
      meituan: {
        consentedAt: LEGAL_CONSENT_GRANTED_AT.getTime(),
        withdrawnAt: null,
      },
      stepfun: {
        consentedAt: LEGAL_CONSENT_GRANTED_AT.getTime(),
        withdrawnAt: null,
      },
      inclusionai: {
        consentedAt: LEGAL_CONSENT_GRANTED_AT.getTime(),
        withdrawnAt: null,
      },
      teleai: {
        consentedAt: LEGAL_CONSENT_GRANTED_AT.getTime(),
        withdrawnAt: null,
      },
      dotsstudio: {
        consentedAt: LEGAL_CONSENT_GRANTED_AT.getTime(),
        withdrawnAt: null,
      },
      router: {
        consentedAt: LEGAL_CONSENT_GRANTED_AT.getTime(),
        withdrawnAt: null,
      },
    },
    ...overrides,
  }
}
