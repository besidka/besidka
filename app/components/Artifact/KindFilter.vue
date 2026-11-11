<template>
  <div
    v-if="options.length"
    role="group"
    aria-label="Filter by type"
    class="flex flex-wrap gap-1.5"
    :data-testid="`${testIdPrefix}-kind-filter`"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="btn btn-sm"
      :class="kind === option.value ? 'btn-accent' : 'btn-soft'"
      :aria-pressed="kind === option.value"
      :data-testid="`${testIdPrefix}-kind-${option.value}`"
      @click="emit('select', option.value)"
    >
      {{ option.label }}
      <span
        class="badge badge-sm badge-soft"
        :data-testid="`${testIdPrefix}-kind-${option.value}-count`"
      >
        {{ option.count }}
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { ArtifactKindCounts } from '#shared/utils/artifacts'
import type { ArtifactKindFilter } from '~/composables/artifacts-library'

const props = defineProps<{
  counts: ArtifactKindCounts | null
  kind: ArtifactKindFilter
  testIdPrefix: string
}>()

const emit = defineEmits<{
  select: [kind: ArtifactKindFilter]
  fallback: []
}>()

const options = computed(() => {
  return buildArtifactKindOptions(props.counts)
})

watch(
  () => [props.counts, props.kind] as const,
  ([counts, kind]) => {
    if (!import.meta.client) {
      return
    }

    if (resolveArtifactKindFilter(kind, counts) !== kind) {
      emit('fallback')
    }
  },
  { immediate: true },
)
</script>
