<template>
  <ClientOnly>
    <template #fallback>
      <SidebarSkeleton :size="size" />
    </template>
    <UiButton
      data-testid="theme-switcher"
      ghost
      :mode="mode"
      :circle="!showLabel"
      :icon-only="!showLabel"
      :icon-only-phone="showLabel"
      :class="{ 'max-sm:btn-circle': showLabel }"
      :size="size"
      :tooltip-position="tipsPosition"
      :title="label"
      :text="preferenceLabel"
      @click="toggle"
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
import type { FaviconTheme } from '~/types/favicon.d'
import type { ButtonProps } from '~/types/button.d'

interface Props {
  tips?: boolean
  tipsPosition?: 'right' | 'left' | 'top' | 'bottom'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  showLabel?: boolean
  mode?: ButtonProps['mode']
}

withDefaults(defineProps<Props>(), {
  size: 'md',
  tipsPosition: 'bottom',
  showLabel: false,
  mode: 'primary',
})

const { setFavicon } = useThemeFavicon()
const colorMode = useColorMode()
const {
  currentPreference,
  pending,
  setThemeColorMeta,
  toggle,
} = useThemeToggle()

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

const preferenceLabel = computed<string>(() => {
  switch (currentPreference.value) {
    case 'light': return 'Light'
    case 'dark': return 'Dark'
    case 'system': return 'System'
    default: return 'System'
  }
})
</script>
