<template>
  <div
    v-if="metadata"
    data-testid="research-meta"
    class="flex items-center gap-2 text-xs font-medium text-base-content/70 mb-1"
  >
    <Icon name="lucide:telescope" size="14" class="text-accent" />
    <span>
      Deep research · {{ modelName }} · {{ tierLabel }}
      <template v-if="durationLabel"> · {{ durationLabel }}</template>
    </span>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'
import type { ResearchMetadata } from '#shared/types/research.d'

const props = defineProps<{
  message: Pick<UIMessage, 'parts'>
}>()

const metadata = computed<ResearchMetadata | null>(() => {
  const part = props.message.parts.find((candidate) => {
    return candidate.type === 'data-research'
  })

  if (!part) {
    return null
  }

  return (part as unknown as { data: ResearchMetadata }).data
})

const modelName = computed<string>(() => {
  if (!metadata.value) {
    return ''
  }

  return getModelName(metadata.value.modelId)
})

const tierLabel = computed<string>(() => {
  if (!metadata.value) {
    return ''
  }

  return metadata.value.level === 'thorough' ? 'Thorough' : 'Quick'
})

const durationLabel = computed<string>(() => {
  const durationMs = metadata.value?.durationMs

  if (!durationMs) {
    return ''
  }

  return formatResearchElapsed(durationMs)
})
</script>
