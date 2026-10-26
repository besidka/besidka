<template>
  <div
    class="grid gap-1.5"
    data-testid="knowledge-meter"
  >
    <div
      v-if="!isReady"
      class="grid gap-2"
      data-testid="knowledge-meter-skeleton"
    >
      <div class="skeleton skeleton--default h-4 w-1/2" />
      <div class="skeleton skeleton--default h-2 w-full" />
      <div class="skeleton skeleton--default h-4 w-3/4" />
    </div>
    <template v-else>
      <p
        class="text-sm font-semibold"
        data-testid="knowledge-meter-headline"
      >
        {{ copy.headline }}
      </p>
      <progress
        class="progress w-full"
        :class="state.isOverBudget ? 'progress-warning' : 'progress-primary'"
        :value="state.fillPercentage"
        max="100"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="state.fillPercentage"
        :aria-valuetext="copy.barLabel"
        :aria-label="copy.headline"
        data-testid="knowledge-meter-bar"
      />
      <p
        class="text-xs text-base-content/70"
        data-testid="knowledge-meter-bar-label"
      >
        {{ copy.barLabel }}
      </p>
      <p
        class="text-sm"
        data-testid="knowledge-meter-summary"
      >
        {{ copy.summary }}<template v-if="copy.costLine">
          · <span data-testid="knowledge-meter-cost">{{
            copy.costLine
          }}</span>
        </template>
      </p>
      <p
        v-if="copy.warning"
        class="text-xs text-warning-content/80 dark:text-warning"
        data-testid="knowledge-meter-warning"
      >
        {{ copy.warning }}
      </p>
      <p
        class="text-xs text-base-content/60"
        data-testid="knowledge-meter-storage"
      >
        {{ storageLine }}
      </p>
      <p
        class="text-xs text-base-content/60"
        data-testid="knowledge-meter-cap"
      >
        {{ capLine }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import type {
  KnowledgeItem,
  KnowledgeMode,
  ProjectKnowledgeSummary,
} from '#shared/types/project-knowledge.d'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import type {
  KnowledgeMeterCopy,
  KnowledgeModelContext,
} from '~/types/knowledge-ui.d'
import type { KnowledgeMeterState } from '~/utils/project-knowledge-ui'

const props = defineProps<{
  items: KnowledgeItem[]
  totals: ProjectKnowledgeSummary['totals']
  mode: KnowledgeMode
  model: KnowledgeModelContext
  storageTotalBytes: number | null
  isReady: boolean
}>()

const state = computed<KnowledgeMeterState>(() => {
  return computeKnowledgeMeter({
    totals: props.totals,
    items: props.items,
    mode: props.mode,
    model: props.model,
  })
})

const copy = computed<KnowledgeMeterCopy>(() => {
  return buildKnowledgeMeterCopy({
    state: state.value,
    mode: props.mode,
    modelName: props.model.name,
  })
})

const storageLine = computed<string>(() => {
  const used = `Knowledge text ${formatKnowledgeBytes(props.totals.textBytes)}`

  if (props.storageTotalBytes === null) {
    return used
  }

  return `${used} of your ${
    formatKnowledgeBytes(props.storageTotalBytes)
  } storage`
})

const capLine = computed<string>(() => {
  const textBytes = formatKnowledgeBytes(props.totals.textBytes)
  const textLimit = formatKnowledgeBytes(KNOWLEDGE_LIMITS.maxProjectTextBytes)

  return `${props.totals.items} of ${
    KNOWLEDGE_LIMITS.maxItemsPerProject
  } items · ${textBytes} of ${textLimit}`
})
</script>
