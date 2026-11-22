export const GOOGLE_CONNECTION_STATUSES = [
  'active',
  'needs_reauth',
  'revoked',
] as const

export type GoogleConnectionStatus = typeof GOOGLE_CONNECTION_STATUSES[number]
