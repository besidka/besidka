import {
  defineNuxtModule,
  createResolver,
  addComponent,
  addImportsDir,
  addPlugin,
  addTypeTemplate,
  addServerImports,
} from '@nuxt/kit'
import {
  MODULE_NAME,
  CONFIG_KEY,
  DEFAULT_COOKIE_NAME,
  DEFAULT_COOKIE_MAX_AGE,
  DEFAULT_REVISION,
  DEFAULT_SHOW_DELAY,
  DEFAULT_CATEGORIES,
} from './constants'
import type {
  ModuleOptions,
  CookieCategoryDeclaration,
  CookieEntryDeclaration,
  CookieConsentChangedPayload,
  ConsentCookie,
  CookieConsentView,
} from './runtime/types/module'

export type {
  ModuleOptions,
  CookieCategoryDeclaration,
  CookieEntryDeclaration,
  CookieConsentChangedPayload,
  ConsentCookie,
  CookieConsentView,
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: MODULE_NAME,
    configKey: CONFIG_KEY,
    compatibility: { nuxt: '>=4.0.0' },
  },
  moduleDependencies: {
    '@nuxtjs/i18n': {
      version: '>=10.0.0',
      defaults: {
        strategy: 'no_prefix',
        defaultLocale: 'en',
        detectBrowserLanguage: false,
        // `locales` is intentionally omitted: defu concatenates arrays, so a
        // default here would duplicate the consumer's locales. The en/uk
        // locale files are registered via the `i18n:registerModule` hook
        // in setup() instead.
      },
    },
  },
  defaults: {
    enabled: true,
    cookieName: DEFAULT_COOKIE_NAME,
    cookieMaxAge: DEFAULT_COOKIE_MAX_AGE,
    revision: DEFAULT_REVISION,
    showDelay: DEFAULT_SHOW_DELAY,
    // Empty on purpose: defineNuxtModule merges defaults with user
    // config via defu, which concatenates arrays — a real default here
    // would duplicate user-declared categories. Resolved in setup().
    categories: [],
  },
  async setup(options, nuxt) {
    const { resolve: r } = createResolver(import.meta.url)

    nuxt.hook('i18n:registerModule', (register) => {
      register({
        langDir: r('runtime/lang'),
        locales: [
          { code: 'en', file: 'en.ts' },
          { code: 'uk', file: 'uk.ts' },
        ],
      })
    })

    const existing = nuxt.options.runtimeConfig.public[CONFIG_KEY] as
      Partial<ModuleOptions> | undefined

    const configuredCategories = existing?.categories?.length
      ? existing.categories
      : options.categories

    nuxt.options.runtimeConfig.public[CONFIG_KEY] = {
      enabled: existing?.enabled ?? options.enabled,
      cookieName: existing?.cookieName ?? options.cookieName,
      cookieMaxAge: existing?.cookieMaxAge ?? options.cookieMaxAge,
      revision: existing?.revision ?? options.revision,
      showDelay: existing?.showDelay ?? options.showDelay,
      categories: configuredCategories.length
        ? configuredCategories
        : DEFAULT_CATEGORIES,
    }

    addTypeTemplate({
      filename: 'types/cookie-consent.d.ts',
      src: r('runtime/types/augment.d.ts'),
    })

    if (!options.enabled) {
      return
    }

    addImportsDir(r('runtime/composables'))

    addComponent({
      name: 'CookieConsentTrigger',
      filePath: r('runtime/components/Trigger.client.vue'),
      mode: 'client',
    })

    addComponent({
      name: 'CookieConsentPopup',
      filePath: r('runtime/components/Popup.client.vue'),
      mode: 'client',
    })

    addComponent({
      name: 'CookieConsentModal',
      filePath: r('runtime/components/Modal.client.vue'),
      mode: 'client',
    })

    addPlugin({
      src: r('runtime/plugins/consent.client.ts'),
      mode: 'client',
    })

    addServerImports([
      {
        name: 'getCookieConsent',
        from: r('runtime/server/utils/consent'),
      },
    ])
  },
})
