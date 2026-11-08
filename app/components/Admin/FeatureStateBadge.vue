<template>
  <span
    class="badge badge-soft badge-sm whitespace-nowrap"
    :class="{
      'badge-error': state.tone === 'off',
      'badge-success': state.tone === 'on',
      'badge-info': state.tone === 'limited',
    }"
  >
    {{ state.label }}
  </span>
</template>
<script setup lang="ts">
import type { AdminFeatureState } from '~/utils/admin-features'

defineProps<{
  state: AdminFeatureState
}>()
</script>
