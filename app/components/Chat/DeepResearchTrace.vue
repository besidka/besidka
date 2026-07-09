<template>
  <div
    v-if="entries.length > 0"
    data-testid="research-trace"
    class="my-1 text-sm"
  >
    <details
      :open="isExpanded"
      class="group collapse"
    >
      <summary
        :id="`research-trace-${message.id}-label`"
        data-testid="research-trace-toggle"
        :aria-controls="`research-trace-${message.id}-content`"
        class="collapse-title flex items-center gap-1 p-0"
        @click.prevent="toggleExpanded"
      >
        <Icon
          name="lucide:list-checks"
          class="size-4 text-base-content/80"
        />
        <span class="font-medium text-xs text-base-content/90">
          Research steps
        </span>
        <Icon
          name="lucide:chevron-right"
          class="size-4 text-base-content/60 transition-transform group-open:rotate-90"
        />
      </summary>
      <div
        :id="`research-trace-${message.id}-content`"
        class="collapse-content mt-3 pb-2 px-0"
      >
        <ul class="flex flex-col gap-2">
          <li
            v-for="(entry, index) in entries"
            :key="`research-trace-${message.id}-${index}`"
            data-testid="research-trace-entry"
            class="flex items-start gap-2 text-xs text-base-content/80"
          >
            <Icon
              :name="iconForKind(entry.kind)"
              class="size-3.5 mt-0.5 shrink-0 text-base-content/60"
            />
            <span>{{ entry.text }}</span>
          </li>
        </ul>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'
import type {
  ResearchTraceEntry,
  ResearchTraceKind,
} from '#shared/types/research.d'

const KIND_ICONS: Record<ResearchTraceKind, string> = {
  thought: 'lucide:brain',
  search: 'lucide:search',
  read: 'lucide:link',
}

const props = defineProps<{
  message: Pick<UIMessage, 'id' | 'parts'>
}>()

const { reasoningExpanded } = useUserSetting()

const entries = computed<ResearchTraceEntry[]>(() => {
  const part = props.message.parts.find((candidate) => {
    return candidate.type === 'data-research-trace'
  })

  if (!part) {
    return []
  }

  return (part as unknown as {
    data: { entries: ResearchTraceEntry[] }
  }).data.entries
})

const isExpanded = shallowRef<boolean>(reasoningExpanded.value)

function toggleExpanded() {
  isExpanded.value = !isExpanded.value
}

function iconForKind(kind: ResearchTraceKind): string {
  return KIND_ICONS[kind]
}
</script>
