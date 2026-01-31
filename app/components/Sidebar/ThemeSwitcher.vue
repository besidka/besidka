<template>
  <ClientOnly>
    <template #fallback>
      <SidebarSkeleton />
    </template>
    <UiButton
      data-testid="theme-switcher"
      ghost
      circle
      :tooltip-position="tipsPosition"
      :title="label"
      :icon-only="true"
      @click="changeColorMode"
    >
      <template #icon>
        <Icon
          v-if="currentPreference === 'light'"
          data-testid="theme-icon-light"
          name="lucide:sun"
          size="20"
        />
        <Icon
          v-else-if="currentPreference === 'dark'"
          data-testid="theme-icon-dark"
          name="lucide:moon"
          size="20"
        />
        <Icon
          v-else
          data-testid="theme-icon-system"
          name="lucide:sun-moon"
          size="20"
        />
      </template>
    </UiButton>
    <Teleport to="body">
      <div
        v-if="pending"
        data-testid="theme-switcher-loading"
        class="fixed z-[9999] inset-0 grid place-content-center background-gradient"
      >
        <div class="flex flex-col gap-4 items-center z-10">
          <SvgoFaviconForAnimation
            short
            animate
            class="size-12 text-accent [&_#Spin]:animate-[spin_3s_ease-in-out_infinite] [&_#Spin]:origin-center"
          />
          Applying theme color...
        </div>
      </div>
    </Teleport>
  </ClientOnly>
</template>

<script setup lang="ts">
import type { FaviconTheme, ThemePreference } from '~/types/favicon.d'

interface Props {
  tips?: boolean
  tipsPosition?: 'right' | 'left' | 'top' | 'bottom'
}

defineProps<Props>()

const { setFavicon } = useThemeFavicon()
const colorMode = useColorMode()
const { isIos } = useDevice()

const pending = shallowRef<boolean>(false)

const currentPreference = computed<ThemePreference>(() => {
  return colorMode.preference as ThemePreference
})

const resolvedTheme = computed<FaviconTheme>(() => {
  return colorMode.value as FaviconTheme
})

onBeforeMount(() => {
  setFavicon(resolvedTheme.value)
  setThemeColorMeta(resolvedTheme.value)
})

function prefersColorSchemeHandler(event: MediaQueryListEvent) {
  if (currentPreference.value === 'system') {
    setThemeColorMeta(event.matches ? 'dark' : 'light')
  }
}

onMounted(() => {
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)')

  darkModeQuery.addEventListener('change', prefersColorSchemeHandler)
})

onBeforeUnmount(() => {
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)')

  darkModeQuery.removeEventListener('change', prefersColorSchemeHandler)
})

const appConfig = useAppConfig()

function setThemeColorMeta(theme: FaviconTheme) {
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

function changeColorMode() {
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

watch(resolvedTheme, (newTheme) => {
  setFavicon(newTheme)

  if (currentPreference.value === 'system') {
    setThemeColorMeta(newTheme)
  }
})

const label = computed<string>(() => {
  switch (currentPreference.value) {
    case 'light': return 'Switch to dark theme'
    case 'dark': return 'Switch to system theme'
    case 'system': return 'Switch to light theme'
    default: return 'Switch theme'
  }
})
</script>
