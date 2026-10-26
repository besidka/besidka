import type {
  TransferConsentProviderKey,
  TransferConsentRouteKind,
} from '#shared/utils/legal-consent'

export type TransferConsentProviderId = TransferConsentProviderKey

export interface ProviderTransferConsent {
  consentedAt: number
  withdrawnAt: number | null
}

export type ProviderTransferConsents = Partial<
  Record<TransferConsentProviderId, ProviderTransferConsent>
>

export type LegalConsentStatus
  = 'current'
    | 'missing'
    | 'withdrawn'
    | 'outdated'

export interface ProviderTransferConsentState {
  providerId: TransferConsentProviderId
  label: string
  country: string
  route: TransferConsentRouteKind
  consentedAt: string | null
  withdrawnAt: string | null
  isGranted: boolean
}

export interface LegalConsentState {
  currentVersion: string
  status: LegalConsentStatus
  termsAcceptedAt: string | null
  termsVersion: string | null
  ageConfirmedAt: string | null
  sensitiveContentConsentAt: string | null
  sensitiveContentConsentVersion: string | null
  sensitiveContentConsentWithdrawnAt: string | null
  transfers: ProviderTransferConsentState[]
}
