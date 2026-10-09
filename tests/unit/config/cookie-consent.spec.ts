import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('defineNuxtConfig', <Configuration>(configuration: Configuration) => {
  return configuration
})

vi.stubGlobal('defineI18nLocale', (loader: () => unknown) => {
  return loader
})

const { default: configuration } = await import('../../../nuxt.config')
const { default: englishLoader } = await import(
  '../../../i18n/locales/cookie-consent.en'
)
const { default: ukrainianLoader } = await import(
  '../../../i18n/locales/cookie-consent.uk'
)

interface CookieEntry {
  id: string
  name: string
  type: string
}

interface EntryTexts {
  description?: string
  duration?: string
}

interface CookieConsentMessages {
  cookieConsent: {
    entries: Record<string, EntryTexts>
  }
}

function loadMessages(loader: unknown): CookieConsentMessages {
  return (loader as () => CookieConsentMessages)()
}

function getManifestEntries(): CookieEntry[] {
  const categories = configuration.cookieConsent
    ?.categories as CookieCategory[]

  return categories.flatMap((category) => {
    return category.entries ?? []
  })
}

interface CookieCategory {
  id: string
  entries?: CookieEntry[]
}

describe('cookie consent manifest contract', () => {
  it(
    'declares the real Better Auth last-used-login-method cookie name, '
    + 'not the unhyphenated/mistyped name that matches no real cookie',
    () => {
      const categories = configuration.cookieConsent
        ?.categories as CookieCategory[]

      const preferences = categories.find((category) => {
        return category.id === 'preferences'
      })

      const entry = preferences?.entries?.find((candidate) => {
        return candidate.id === 'last-login-method'
      })

      expect(entry?.type).toBe('cookie')
      expect(entry?.name).toBe('better-auth.last_used_login_method')
    },
  )

  it('declares every entry id only once', () => {
    const ids = getManifestEntries().map((entry) => {
      return entry.id
    })

    expect(new Set(ids).size).toBe(ids.length)
  })

  describe.each([
    ['en', englishLoader],
    ['uk', ukrainianLoader],
  ])('%s locale', (_locale, loader) => {
    it('describes every manifest entry with a description and duration',
      () => {
        const texts = loadMessages(loader).cookieConsent.entries
        const incomplete = getManifestEntries().filter((entry) => {
          const entryTexts = texts[entry.id]

          return !entryTexts?.description?.trim()
            || !entryTexts?.duration?.trim()
        }).map((entry) => {
          return entry.id
        })

        expect(incomplete).toEqual([])
      })

    it('has no texts for entries that are not in the manifest', () => {
      const manifestIds = getManifestEntries().map((entry) => {
        return entry.id
      })
      const orphaned = Object.keys(
        loadMessages(loader).cookieConsent.entries,
      ).filter((id) => {
        return !manifestIds.includes(id)
      })

      expect(orphaned).toEqual([])
    })
  })

  it('declares the preference keys written through preference storage',
    () => {
      const names = getManifestEntries().map((entry) => {
        return entry.name
      })

      expect(names).toEqual(expect.arrayContaining([
        'settings_favorite_models',
        'settings_favorite_gateway_models',
        'settings_web_search_tool',
      ]))
    })
})
