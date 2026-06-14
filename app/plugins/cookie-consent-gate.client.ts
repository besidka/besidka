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
        window.localStorage.removeItem('nuxt-color-mode')
        document.cookie = 'nuxt-color-mode=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
      }
    },
    { flush: 'post' },
  )

  const { lastLoginMethod } = useAuth()

  watch(lastLoginMethod, () => {
    if (!isAllowed('preferences')) {
      document.cookie = 'better_auth.last_login_method=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
    }
  })
})
