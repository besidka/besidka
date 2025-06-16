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

onBeforeMount(() => {
  setFavicon(colorMode.preference as FaviconTheme)
})

function changeColorMode() {
  colorMode.value = colorMode.value === 'light' ? 'dark' : 'light'
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
