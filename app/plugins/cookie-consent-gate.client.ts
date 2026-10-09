const COLOR_MODE_STORAGE_KEY = 'nuxt-color-mode'

function purgeColorModeStorage() {
  try {
    window.localStorage.removeItem(COLOR_MODE_STORAGE_KEY)
    document.cookie = `${COLOR_MODE_STORAGE_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  } catch {
    return
  }
}

/**
 * Keeps the color-mode preference out of storage until the user consents
 * to the preferences category. `@nuxtjs/color-mode` writes its preference
 * synchronously when its own plugin runs, which precedes this plugin, so the
 * key is removed in the same synchronous startup pass. The write-then-purge
 * window is never persisted across a reload; the head script only reads the
 * key on the next load, by which time it is gone.
 */
export default defineNuxtPlugin(() => {
  const {
    isAllowed,
    onConsentChange,
    consentId,
    consentDate,
  } = useCookieConsent()
  const { flushPending } = usePreferenceStorage()
  const colorMode = useColorMode()
  const config = useRuntimeConfig()

  if (!isAllowed('preferences')) {
    purgeColorModeStorage()
  }

  onConsentChange(({ granted, denied, changed }) => {
    if (granted.includes('preferences')) {
      flushPending()

      window.localStorage.setItem(
        'nuxt-color-mode',
        colorMode.preference,
      )
    }

    if (denied.includes('preferences')) {
      // The module's cleanup routine already removes declared entries.
      // pending map values remain for in-session continuity — no action needed.
    }

    const id = consentId.value
    const date = consentDate.value

    if (id && date) {
      const cookieConsent = config.public.cookieConsent as {
        revision: number
      }

      // Deferred: useCookie flushes document.cookie on the next tick;
      // sending immediately would race ahead of the consent cookie and
      // break the server-side corroboration (consistent flag).
      setTimeout(() => {
        $fetch('/api/v1/consents', {
          method: 'POST',
          body: {
            id,
            date,
            revision: cookieConsent.revision,
            granted,
            denied,
            changed,
          },
        }).catch(() => {})
      }, 150)
    }
  })

  watch(
    () => colorMode.preference,
    () => {
      if (!isAllowed('preferences')) {
        purgeColorModeStorage()
      }
    },
    { flush: 'post' },
  )

  const { lastLoginMethod, client } = useAuth()

  watch(lastLoginMethod, () => {
    if (!isAllowed('preferences')) {
      client.clearLastUsedLoginMethod?.()
    }
  })
})
