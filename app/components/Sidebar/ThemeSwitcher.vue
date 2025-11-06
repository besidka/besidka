<template>
  <ClientOnly>
    <template #fallback>
      <SidebarSkeleton />
    </template>
    <UiButton
      ghost
      circle
      :tooltip-position="tipsPosition"
      :title="label"
      :icon-only="true"
      @click="changeColorMode"
    >
      <template #icon>
        <span class="swap swap-rotate">
          <Icon
            :class="{
              'swap-off': !checked,
              'swap-on': checked,
            }"
            name="lucide:sun"
            size="20"
          />
          <Icon
            :class="{
              'swap-off': checked,
              'swap-on': !checked,
            }"
            name="lucide:moon"
            size="20"
          />
        </span>
      </template>
    </UiButton>
    <Teleport to="body">
      <div
        v-if="pending"
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
import type { FaviconTheme } from '~/types/favicon.d'

interface Props {
  tips?: boolean
  tipsPosition?: 'right' | 'left' | 'top' | 'bottom'
}

defineProps<Props>()

const { setFavicon } = useThemeFavicon()
const colorMode = useColorMode()
const { isIos } = useDevice()

const pending = shallowRef<boolean>(false)

onBeforeMount(() => {
  setFavicon(colorMode.preference as FaviconTheme)
  setThemeColorMeta(colorMode.preference as FaviconTheme)
})

function prefersColorSchemeHandler(event: MediaQueryListEvent) {
  setThemeColorMeta(event.matches ? 'dark' : 'light')
}

onMounted(() => {
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)')

  darkModeQuery.addEventListener('change', prefersColorSchemeHandler)
})

onBeforeUnmount(() => {
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)')

  darkModeQuery.removeEventListener('change', prefersColorSchemeHandler)
})

function setThemeColorMeta(theme: FaviconTheme) {
  const appConfig = useAppConfig()

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
  const result = colorMode.value === 'light' ? 'dark' : 'light'

  colorMode.value = result
  setThemeColorMeta(result as FaviconTheme)
  reloadStandaloneApp()
}

const checked = computed<boolean>(() => colorMode.value !== 'light')

watch(checked, (value: boolean) => {
  colorMode.preference = !value ? 'light' : 'dark'
  setFavicon(colorMode.preference as FaviconTheme)
})

const label = computed<string>(() => {
  return checked.value ? 'Switch to light theme' : 'Switch to dark theme'
})
</script>
