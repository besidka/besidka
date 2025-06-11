<template>
  <label
    class="flex items-center bubble size-12 !rounded-full flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:focus-visible:outline-primary-content"
    :class="{
          'tooltip': tips,
          'tooltip-left': tips && tipsPosition === 'left',
          'tooltip-right': tips && tipsPosition === 'right',
          'tooltip-top': tips && tipsPosition === 'top',
          'tooltip-bottom': tips && tipsPosition === 'bottom',
    }"
    :data-tip="tips ? label : null"
  >
    <span class="swap swap-rotate">
      <input
        v-model="checked"
        type="checkbox"
        class="theme-controller outline-none"
      >
      <Icon
        class="swap-off"
        name="lucide:sun"
        size="20"
      />
      <Icon
        class="swap-on"
        name="lucide:moon"
        size="20"
      />
    </span>
    <span
      :class="{
        'sr-only': tips,
      }"
    >
      {{ label }}
    </span>
  </label>
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

const checked = shallowRef<boolean>(colorMode.value !== 'light')

watch(checked, (value: boolean) => {
  colorMode.preference = !value ? 'light' : 'dark'
  setFavicon(colorMode.preference as FaviconTheme)
})

const label = computed<string>(() => {
  return checked.value ? 'Switch to light theme' : 'Switch to dark theme'
})
</script>
