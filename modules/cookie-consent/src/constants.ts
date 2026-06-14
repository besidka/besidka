import type { CookieCategoryDeclaration } from './runtime/types/module'

export const MODULE_NAME = 'cookie-consent'
export const CONFIG_KEY = 'cookieConsent'
export const DEFAULT_COOKIE_NAME = 'cookies_consent'
export const DEFAULT_COOKIE_MAX_AGE = 60 * 60 * 24 * 180 // 180 days
export const DEFAULT_REVISION = 1
export const DEFAULT_SHOW_DELAY = 1200
export const COOKIE_CONSENT_STATE_KEY = 'cookie-consent:granted'
export const COOKIE_CONSENT_VIEW_KEY = 'cookie-consent:view'

export const DEFAULT_CATEGORIES: CookieCategoryDeclaration[] = [
  {
    id: 'necessary',
    required: true,
    entries: [],
  },
  {
    id: 'preferences',
    required: false,
    entries: [],
  },
  {
    id: 'analytics',
    required: false,
    entries: [],
  },
  {
    id: 'marketing',
    required: false,
    entries: [],
  },
]
