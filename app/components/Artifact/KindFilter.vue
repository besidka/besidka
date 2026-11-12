<template>
  <HistoryFilterButtons
    :options="options"
    :model-value="kind"
    label="Filter by type"
    :test-id-prefix="`${testIdPrefix}-kind`"
    @select="onSelect"
  />
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

function onSelect(value: string) {
  emit('select', value as ArtifactKindFilter)
}

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
