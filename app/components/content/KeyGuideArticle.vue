<template>
  <section v-if="!isOnKeysCard" data-testid="key-guide-article">
    <slot />
  </section>
</template>

<script setup lang="ts">
import {
  KEY_GUIDE_SURFACE_INJECTION_KEY,
  type KeyGuideSurface,
} from '~/utils/key-guide-surface'

const surface = inject<KeyGuideSurface>(
  KEY_GUIDE_SURFACE_INJECTION_KEY,
  'page',
)

const isOnKeysCard = computed<boolean>(() => {
  return surface === 'card'
})
</script>
