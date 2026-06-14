export interface CookieEntryDeclaration {
  id: string
  name: string
  type?: 'cookie' | 'localStorage' | 'sessionStorage'
}

export interface CookieCategoryDeclaration {
  id: string
  required?: boolean
  entries?: CookieEntryDeclaration[]
}

export interface ModuleOptions {
  enabled: boolean
  cookieName: string
  cookieMaxAge: number
  revision: number
  showDelay: number
  categories: CookieCategoryDeclaration[]
}

export interface CookieConsentChangedPayload {
  granted: string[]
  denied: string[]
  changed: string[]
}

export interface ConsentCookie {
  v: number
  granted: string[]
  id?: string
  date?: string
}

export type CookieConsentView = 'hidden' | 'popup' | 'modal'
