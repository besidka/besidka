<template>
  <span
    v-if="isVisible"
    data-testid="chat-artifact-badge"
    class="badge badge-soft badge-sm gap-1 shrink-0"
    :title="label"
    :aria-label="label"
  >
    <Icon name="lucide:app-window" size="10" />
    <template v-if="compact">{{ count }}</template>
    <template v-else>
      <span class="sm:hidden">{{ count }}</span>
      <span class="max-sm:hidden">{{ label }}</span>
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
