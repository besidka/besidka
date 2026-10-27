export type SharePiiDetectorKind
  = | 'email'
    | 'phone'
    | 'iban'
    | 'national-id'
    | 'tax-id'
    | 'payment-card'
    | 'passport'

export type SharePiiKind = SharePiiDetectorKind | 'personal-data'

export type SharePiiSource = 'detector' | 'typesafe'

export interface SharePiiWarning {
  kind: SharePiiKind
  source: SharePiiSource
}

export interface SharePiiCheckResult {
  warnings: SharePiiWarning[]
  checked: boolean
}
