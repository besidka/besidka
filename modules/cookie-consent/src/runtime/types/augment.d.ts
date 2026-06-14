import type {
  ModuleOptions,
  CookieCategoryDeclaration,
  CookieEntryDeclaration,
  CookieConsentChangedPayload,
  ConsentCookie,
  CookieConsentView,
} from '@besidka/nuxt-cookie-consent'

declare module '@nuxt/schema' {
  interface RuntimeConfig {
    public: {
      cookieConsent: ModuleOptions
    }
  }
}

declare module '#app' {
  interface RuntimeNuxtHooks {
    'cookie-consent:changed': (
      payload: CookieConsentChangedPayload,
    ) => void
  }
}

export type {
  ModuleOptions,
  CookieCategoryDeclaration,
  CookieEntryDeclaration,
  CookieConsentChangedPayload,
  ConsentCookie,
  CookieConsentView,
}
