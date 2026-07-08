<template>
  <div
    data-testid="deep-research-trigger"
    class="btn btn-xs btn-accent btn-active pointer-events-none rounded-full pl-[5px]"
    :class="{
      'btn-disabled': disabled,
      'tooltip tooltip-top': isDesktop,
    }"
    :aria-label="`Deep research is on for this model — ${estimateLabel}`"
    :data-tip="estimateLabel"
  >
    <Icon name="lucide:telescope" size="16" class="text-current" />
    <span v-if="research">Deep research</span>
  </div>
</template>

<script setup lang="ts">
import type { ModelResearchConfig } from '#shared/types/research.d'

const props = defineProps<{
  research: ModelResearchConfig | null
  disabled?: boolean
}>()

const { isDesktop } = useDevice()

const estimateLabel = computed<string>(() => {
  if (!props.research) {
    return ''
  }

  return `${props.research.costEstimate} · ${props.research.timeEstimate}`
})
</script>
