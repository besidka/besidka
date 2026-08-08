import type { FaviconTheme, ThemePreference } from '~/types/favicon.d'

export const useThemeToggle = () => {
  const colorMode = useColorMode()
  const { isIos } = useDevice()
  const appConfig = useAppConfig()

  const pending = useState<boolean>('theme-toggle:pending', () => false)

  const currentPreference = computed<ThemePreference>(() => {
    return colorMode.preference as ThemePreference
  })

  const resolvedTheme = computed<FaviconTheme>(() => {
    return colorMode.value as FaviconTheme
  })

  function setThemeColorMeta(theme: FaviconTheme) {
    const existing = document.querySelectorAll('meta[name="theme-color"]')

    existing.forEach((element, index) => {
      if (index === 0) {
        element.removeAttribute('media')
      } else {
        element.remove()
      }
    })

    let themeColorMeta = document.querySelector('meta[name="theme-color"]')

    if (!themeColorMeta) {
      themeColorMeta = document.createElement('meta')
      themeColorMeta.setAttribute('name', 'theme-color')
      document.head.appendChild(themeColorMeta)
    }

    if (
      theme === 'light'
      && window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      themeColorMeta.setAttribute(
        'content',
        appConfig.themeColor['lightForDark'],
      )
    } else {
      themeColorMeta.setAttribute('content', appConfig.themeColor[theme])
    }
  }

  async function reloadStandaloneApp() {
    if (!isIos) {
      return
    }

    pending.value = true
    await nextTick()

    setTimeout(() => {
      reloadNuxtApp({
        force: true,
      })
    }, 500)
  }

  function toggle() {
    const nextPreference: ThemePreference
      = currentPreference.value === 'light'
        ? 'dark'
        : currentPreference.value === 'dark'
          ? 'system'
          : 'light'

    colorMode.preference = nextPreference
    setThemeColorMeta(resolvedTheme.value)
    reloadStandaloneApp()
  }

  return {
    currentPreference,
    pending,
    setThemeColorMeta,
    toggle,
  }
}
