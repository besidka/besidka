<template>
  <div ref="root">
    <div
      v-if="isPending"
      data-testid="gateway-models-loading"
      class="min-h-full flex flex-col items-center justify-center gap-2 px-4 py-10 text-center"
    >
      <span class="loading loading-spinner loading-md opacity-40" />
      <p class="text-xs opacity-60">
        Loading {{ gatewayLabel }} models…
      </p>
    </div>
    <div
      v-else-if="error"
      data-testid="gateway-models-error"
      class="min-h-full flex flex-col items-center justify-center gap-2 px-4 py-10 text-center"
    >
      <Icon
        name="lucide:cloud-alert"
        size="24"
        class="opacity-40"
      />
      <p class="text-xs opacity-60">
        Could not load {{ gatewayLabel }} models.
      </p>
      <button
        type="button"
        data-testid="gateway-models-retry"
        class="btn btn-ghost btn-xs rounded-full text-accent"
        @click="refresh()"
      >
        Try again
      </button>
    </div>
    <template v-else-if="filteredModels.length">
      <div
        :id="listboxId"
        role="listbox"
        :aria-label="`${gatewayLabel} models`"
      >
        <template
          v-for="section in sections"
          :key="section.id"
        >
          <p
            v-if="section.label"
            :id="`${sectionLabelId}-${section.id}`"
            class="px-2 pt-1.5 pb-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-50"
          >
            {{ section.label }}
          </p>
          <ul
            class="flex flex-col gap-0.5"
            :role="section.label ? 'group' : 'presentation'"
            :aria-labelledby="section.label
              ? `${sectionLabelId}-${section.id}`
              : undefined
            "
          >
            <template
              v-for="model in section.entries"
              :key="model.id"
            >
              <ChatInputModelsTriggerGatewayModelItem
                :model="model"
                :is-selected="selectedModelId === model.id"
                :is-highlighted="highlightedModelId === model.id"
                :is-favorite="favoriteModelIds.includes(model.id)"
                :is-detail-open="detailModelId === model.id"
                @select="emit('select', model.id)"
                @toggle-favorite="emit('toggleFavorite', model.id)"
                @toggle-detail="emit('toggleDetail', model.id)"
              />
              <li
                v-if="detailModelId === model.id"
                role="presentation"
                class="py-0.5"
              >
                <ChatInputModelsTriggerGatewayModelDetail
                  :model="model"
                  :gateway-label="gatewayLabel"
                  @close="emit('closeDetail')"
                />
              </li>
            </template>
          </ul>
        </template>
      </div>
    </template>
    <div
      v-else
      data-testid="gateway-models-empty"
      class="min-h-full flex flex-col items-center justify-center gap-2 px-4 py-10 text-center"
    >
      <Icon
        name="lucide:search-x"
        size="24"
        class="opacity-40"
      />
      <p class="text-xs opacity-60">
        {{ emptyMessage }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GatewayId, GatewayModel } from '#shared/types/gateways.d'
import type { GatewayPickerSection } from '~/types/models-picker'

const props = defineProps<{
  gatewayId: GatewayId
  gatewayLabel: string
  searchTerm: string
  isFavoritesOnly: boolean
  favoriteModelIds: string[]
  selectedModelId: string | null
  detailModelId: string | null
  listboxId: string
}>()

const emit = defineEmits<{
  select: [modelId: string]
  toggleFavorite: [modelId: string]
  toggleDetail: [modelId: string]
  closeDetail: []
  highlight: [optionId: string | null]
  pendingChange: [isPending: boolean]
}>()

const { models, pending, error, refresh } = useGatewayCatalog(
  toRef(props, 'gatewayId'),
)

const highlightedModelId = shallowRef<string | null>(null)
const root = useTemplateRef<HTMLDivElement>('root')
const sectionLabelId = useId()

const isPending = computed<boolean>(() => {
  return pending.value && !models.value.length
})

const filteredModels = computed<GatewayModel[]>(() => {
  const term = props.searchTerm.trim().toLowerCase()

  return models.value.filter((model) => {
    if (props.isFavoritesOnly && !props.favoriteModelIds.includes(model.id)) {
      return false
    }

    if (!term) {
      return true
    }

    return model.name.toLowerCase().includes(term)
      || model.id.toLowerCase().includes(term)
  })
})

const sections = computed<GatewayPickerSection[]>(() => {
  const favorites = filteredModels.value.filter((model) => {
    return props.favoriteModelIds.includes(model.id)
  })
  const others = filteredModels.value.filter((model) => {
    return !props.favoriteModelIds.includes(model.id)
  })

  if (!favorites.length || !others.length) {
    return [{ id: 'all', label: '', entries: [...favorites, ...others] }]
  }

  return [
    { id: 'favorites', label: 'Favorites', entries: favorites },
    { id: 'others', label: 'Other models', entries: others },
  ]
})

const emptyMessage = computed<string>(() => {
  if (props.isFavoritesOnly) {
    return `No favorite ${props.gatewayLabel} models yet.`
  }

  if (props.searchTerm.trim()) {
    return `No models match “${props.searchTerm.trim()}”.`
  }

  return `${props.gatewayLabel} returned no models.`
})

async function scrollHighlightedIntoView() {
  await nextTick()

  if (!highlightedModelId.value) {
    return
  }

  const element = root.value?.querySelector<HTMLElement>(
    `[id="gateway-model-option-${highlightedModelId.value}"]`,
  )

  element?.scrollIntoView?.({ block: 'nearest' })
}

function setHighlight(modelId: string | null) {
  emit('closeDetail')
  highlightedModelId.value = modelId
  scrollHighlightedIntoView()
}

function highlightFirst() {
  setHighlight(filteredModels.value[0]?.id ?? null)
}

function highlightLast() {
  const entries = filteredModels.value

  setHighlight(entries[entries.length - 1]?.id ?? null)
}

function moveHighlight(step: number) {
  const entries = filteredModels.value

  if (!entries.length) {
    return
  }

  const currentIndex = entries.findIndex((model) => {
    return model.id === highlightedModelId.value
  })

  const nextIndex = currentIndex === -1
    ? 0
    : (currentIndex + step + entries.length) % entries.length

  setHighlight(entries[nextIndex]?.id ?? null)
}

function selectHighlighted() {
  if (!highlightedModelId.value) {
    return
  }

  emit('select', highlightedModelId.value)
}

watch(highlightedModelId, (value) => {
  emit('highlight', value ? `gateway-model-option-${value}` : null)
}, { immediate: true })

watch(isPending, (value) => {
  emit('pendingChange', value)
}, { immediate: true })

watch(filteredModels, (entries) => {
  const stillVisible = entries.some((model) => {
    return model.id === highlightedModelId.value
  })

  if (stillVisible) {
    return
  }

  const selectedIsVisible = entries.some((model) => {
    return model.id === props.selectedModelId
  })

  highlightedModelId.value = selectedIsVisible
    ? props.selectedModelId
    : entries[0]?.id ?? null
}, { immediate: true })

defineExpose({
  moveHighlight,
  highlightFirst,
  highlightLast,
  selectHighlighted,
})
</script>
