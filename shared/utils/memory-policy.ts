export const memoryScopes = ['profile', 'project'] as const

export const memoryCategories = [
  'profile',
  'preferences',
  'areas',
  'topics',
  'people',
] as const

export const memorySensitivities = ['none', 'special'] as const

export const memoryOrigins = ['user', 'tool', 'extraction', 'import'] as const

export const memorySensitiveCategories = [
  'health',
  'religion-or-belief',
  'political-opinion',
  'racial-or-ethnic-origin',
  'sex-life-or-orientation',
  'trade-union',
  'genetic',
  'biometric',
  'legal-dispute',
  'drugs',
] as const

export const memoryModelSources = ['setting', 'chat', 'fallback'] as const

export const alwaysInjectedMemoryCategories = [
  'profile',
  'preferences',
] as const

export const MEMORY_LIMITS = {
  maxAccountEntries: 30,
  maxProjectEntries: 15,
  maxBodyBytes: 2048,
  maxAlwaysInjectedBodyBytes: 1024,
  maxDescriptionChars: 100,
  maxTitleChars: 80,
  maxSlugChars: 64,
  maxAboutMeChars: 4000,
  maxSourceChatIds: 20,
  indexTokenBudget: 2500,
} as const

export const neverStoreKinds = [
  {
    id: 'payment-card',
    label: 'Payment card numbers',
    detection: 'deterministic',
  },
  {
    id: 'iban',
    label: 'IBAN and bank account numbers',
    detection: 'deterministic',
  },
  {
    id: 'national-id',
    label: 'Government ID numbers (PESEL, SSN)',
    detection: 'deterministic',
  },
  {
    id: 'tax-id',
    label: 'Tax identification numbers',
    detection: 'deterministic',
  },
  {
    id: 'passport',
    label: 'Passport numbers',
    detection: 'deterministic',
  },
  {
    id: 'api-key',
    label: 'API keys and access tokens',
    detection: 'deterministic',
  },
  {
    id: 'jwt',
    label: 'JSON Web Tokens',
    detection: 'deterministic',
  },
  {
    id: 'credential',
    label: 'Passwords and credentials',
    detection: 'deterministic',
  },
  {
    id: 'private-key',
    label: 'Private keys',
    detection: 'deterministic',
  },
  {
    id: 'criminal-history',
    label: 'Criminal history',
    detection: 'extractor',
  },
  {
    id: 'immigration-status',
    label: 'Immigration or residence-permit status',
    detection: 'extractor',
  },
  {
    id: 'home-address',
    label: 'Precise home address',
    detection: 'extractor',
  },
  {
    id: 'live-location',
    label: 'Live location',
    detection: 'extractor',
  },
  {
    id: 'other',
    label: 'Other highly sensitive identifiers',
    detection: 'extractor',
  },
] as const

export const neverStoreKindIds = [
  'payment-card',
  'iban',
  'national-id',
  'tax-id',
  'passport',
  'api-key',
  'jwt',
  'credential',
  'private-key',
  'criminal-history',
  'immigration-status',
  'home-address',
  'live-location',
  'other',
] as const

export const MEMORY_SETTING_DEFAULTS = {
  memoryEnabled: false,
  chatSearchEnabled: true,
  memoryIncludeSensitive: false,
  aboutMe: null as string | null,
  useAccountMemory: true,
}

export const REDACTION_PLACEHOLDER = '[redacted]'

export const MEMORY_ENTRY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
