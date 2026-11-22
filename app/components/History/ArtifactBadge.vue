<template>
  <span
    v-if="isVisible"
    data-testid="chat-artifact-badge"
    class="badge badge-soft badge-sm gap-1 shrink-0"
    :title="label"
  >
    <Icon name="lucide:app-window" size="10" aria-hidden="true" />
    <template v-if="compact">
      <span aria-hidden="true">{{ count }}</span>
      <span class="sr-only">{{ label }}</span>
    </template>
    <template v-else>
      <span class="sm:hidden" aria-hidden="true">{{ count }}</span>
      <span class="max-sm:hidden">{{ label }}</span>
      <span class="sm:hidden sr-only">{{ label }}</span>
    </template>
  </span>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  count?: number
  compact?: boolean
}>(), {
  count: 0,
  compact: false,
})

const artifactsFeature = useFeature('artifacts')

const isVisible = computed<boolean>(() => {
  return artifactsFeature.value.active && props.count > 0
})

const label = computed<string>(() => {
  return props.count === 1 ? '1 artifact' : `${props.count} artifacts`
})
</script>
