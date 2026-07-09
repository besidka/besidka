<template>
  <div
    v-if="metadata"
    data-testid="research-meta"
    class="my-1 text-sm"
  >
    <div
      v-if="entries.length === 0"
      class="
        flex items-center gap-2 text-xs font-medium text-base-content/70
        mb-1
      "
    >
      <SvgoGeminiShort
        v-if="metadata.provider === 'google'"
        class="size-3.5 fill-base-content/70"
      />
      <SvgoOpenai
        v-if="metadata.provider === 'openai'"
        class="size-3.5 fill-base-content/70"
      />
      <span>
        {{ modelName }} · {{ tierLabel }}
        <template v-if="durationLabel"> · {{ durationLabel }}</template>
      </span>
    </div>

    <details
      v-else
      :open="isExpanded"
      class="group collapse"
    >
      <summary
        :id="`research-meta-${message.id}-label`"
        data-testid="research-trace-toggle"
        :aria-controls="`research-meta-${message.id}-content`"
        class="collapse-title flex items-center gap-1 p-0"
        @click.prevent="toggleExpanded"
      >
        <SvgoGeminiShort
          v-if="metadata.provider === 'google'"
          class="size-3.5 fill-base-content/70"
        />
        <SvgoOpenai
          v-if="metadata.provider === 'openai'"
          class="size-3.5 fill-base-content/70"
        />
        <span class="font-medium text-xs text-base-content/70">
          {{ modelName }} · {{ tierLabel }}
          <template v-if="durationLabel"> · {{ durationLabel }}</template>
        </span>
        <Icon
          name="lucide:chevron-right"
          class="
            size-4 text-base-content/60 transition-transform
            group-open:rotate-90
          "
        />
      </summary>
      <div
        :id="`research-meta-${message.id}-content`"
        class="collapse-content mt-3 pb-2 px-0"
      >
        <ul
          class="
            timeline timeline-compact timeline-snap-icon timeline-vertical
          "
        >
          <li
            v-for="(entry, index) in parsedEntries"
            :key="`research-trace-${message.id}-${index}`"
            data-testid="research-trace-entry"
          >
            <hr
              v-if="index > 0"
              class="bg-base-100"
            >
            <div class="timeline-middle">
              <span
                class="
                  flex size-5 items-center justify-center rounded-full
                  border border-base-100 bg-base-100
                "
              >
                <Icon
                  :name="iconForKind(entry.kind)"
                  class="!size-3 text-accent"
                />
              </span>
            </div>
            <button
              v-if="entry.kind === 'read'"
              type="button"
              data-testid="research-trace-link"
              class="
                link badge badge-soft badge-sm gap-1 no-underline
                timeline-end my-2.5 mx-2
              "
              @click="openResearchLink(entry.url)"
            >
              <span class="max-w-40 truncate text-xs">{{ entry.title }}</span>
            </button>
            <details
              v-else-if="entry.description.length > 0"
              :open="expandedEntryIndex === index"
              class="group/point timeline-end collapse my-2.5 mx-2 w-full"
            >
              <summary
                data-testid="research-trace-entry-toggle"
                class="collapse-title flex items-center gap-1 p-0 text-xs"
                @click.prevent="toggleEntry(index)"
              >
                <span class="min-w-0 truncate text-base-content/80">
                  {{ entry.title }}
                </span>
                <Icon
                  name="lucide:chevron-right"
                  class="
                    size-4 shrink-0
                    transition-transform group-open/point:rotate-90
                  "
                />
              </summary>
              <div class="collapse-content mt-2 pb-0 px-0">
                <p class="text-xs text-base-content/80 whitespace-pre-wrap">
                  {{ entry.description }}
                </p>
              </div>
            </details>
            <div
              v-else
              class="timeline-end my-2.5 mx-2 text-xs text-base-content/80"
            >
              {{ entry.title }}
            </div>
            <hr
              v-if="index < parsedEntries.length - 1"
              class="bg-base-100"
            >
          </li>
        </ul>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'
import type {
  ResearchMetadata,
  ResearchTraceEntry,
  ResearchTraceKind,
} from '#shared/types/research.d'

interface ParsedResearchTraceEntry {
  kind: ResearchTraceKind
  title: string
  description: string
  url: string
}

const KIND_ICONS: Record<ResearchTraceKind, string> = {
  thought: 'lucide:brain',
  search: 'lucide:search',
  read: 'lucide:link',
}

const props = defineProps<{
  message: Pick<UIMessage, 'id' | 'parts'>
}>()

const {
  reasoningExpanded,
  allowExternalLinks,
  setAllowExternalLinks,
} = useUserSetting()

const metadata = computed<ResearchMetadata | null>(() => {
  const part = props.message.parts.find((candidate) => {
    return candidate.type === 'data-research'
  })

  if (!part) {
    return null
  }

  return (part as unknown as { data: ResearchMetadata }).data
})

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

const parsedEntries = computed<ParsedResearchTraceEntry[]>(() => {
  return entries.value.map((entry) => {
    if (entry.kind === 'read') {
      return {
        kind: entry.kind,
        title: formatResearchLinkLabel(entry.text),
        description: '',
        url: entry.text,
      }
    }

    const parsed = parseResearchStepText(entry.text)

    return {
      kind: entry.kind,
      title: parsed.title,
      description: parsed.description,
      url: '',
    }
  })
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

const isExpanded = shallowRef<boolean>(reasoningExpanded.value)
const expandedEntryIndex = shallowRef<number>(-1)

function toggleExpanded() {
  isExpanded.value = !isExpanded.value
}

function toggleEntry(index: number) {
  expandedEntryIndex.value = expandedEntryIndex.value === index ? -1 : index
}

function iconForKind(kind: ResearchTraceKind): string {
  return KIND_ICONS[kind]
}

async function openResearchLink(url: string): Promise<void> {
  if (allowExternalLinks.value) {
    window.open(url, '_blank', 'noopener,noreferrer')

    return
  }

  const label = formatResearchLinkLabel(url)
  const result = await useConfirm({
    text: `Open ${label}?`,
    subtitle: 'You are about to leave and open an external website. Make sure you trust this source before continuing.',
    actions: ['Open', 'Open always'],
    labelDecline: 'Close',
  })

  if (!result) return

  if (result.index === 1) {
    const alsoConfirmed = await useConfirm({
      text: 'Always open external links?',
      subtitle: 'All future links will open without asking. You can reset this in Settings.',
      actions: ['Yes, always'],
      labelDecline: 'No, just this once',
    })

    if (alsoConfirmed) {
      void setAllowExternalLinks(true)
    }
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}
</script>
