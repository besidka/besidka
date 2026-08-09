<template>
  <div
    ref="root"
    class="relative"
  >
    <button
      ref="trigger"
      type="button"
      aria-label="Select model"
      data-testid="current-model-trigger"
      class="btn btn-ghost btn-sm rounded-full [--size:calc(var(--size-field)_*_6)] transition-colors duration-200 max-xxs:max-w-40"
      :class="{ 'btn-active': isOpen }"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      :aria-controls="panelId"
      @click="toggle"
    >
      <ProviderIcon
        v-if="triggerProviderId"
        :provider-id="triggerProviderId"
        class="w-4 fill-base-content/40"
      />
      <span class="block truncate text-left min-w-0">
        {{ getModelName(toValue(userModel)) }}
      </span>
      <Icon
        name="lucide:chevron-down"
        size="14"
        :class="{ 'scale-y-[-1]': isOpen }"
      />
    </button>
    <ClientOnly>
      <Transition
        enter-active-class="transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-bottom"
        leave-active-class="transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-bottom"
        enter-from-class="opacity-0 scale-95"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="isOpen"
          :id="panelId"
          data-testid="models-picker-panel"
          class="absolute bottom-full left-0 z-50 mb-2 w-[min(30rem,calc(100vw-4rem))]"
        >
          <div
            class="bubble-without-background flex flex-col max-h-[60dvh] bg-base-100 border border-base-content/10 shadow-xl"
          >
            <div
              class="shrink-0 flex items-center gap-1 p-2 border-b border-base-content/10"
            >
              <ChatInputModelsTriggerSearch
                v-model="searchQuery"
                :autofocus="$device.isDesktop"
                :controls="listboxId"
                :active-descendant="highlightedOptionId"
                class="grow min-w-0"
                @keydown="onSearchKeydown"
              />
              <ChatInputModelsTriggerFilterDropdown
                v-model="activeCategory"
              />
            </div>
            <div class="flex flex-1 min-h-0">
              <ChatInputModelsTriggerProviderRail
                v-if="!isSearching"
                :providers="providers"
                :active-provider-id="activeProviderId"
                :is-favorites-only="isFavoritesOnly"
                :has-favorites="hasFavorites"
                @toggle-provider="toggleProvider"
                @toggle-favorites="toggleFavoritesOnly"
              />
              <div
                ref="resultsContainer"
                class="flex-1 min-h-[14rem] overflow-y-auto p-1.5"
                :class="{ 'pb-9': filteredModels.length }"
              >
                <div
                  :id="listboxId"
                  role="listbox"
                  aria-label="Models"
                >
                  <template
                    v-for="section in sections"
                    :key="section.id"
                  >
                    <p
                      v-if="section.label"
                      :id="`${section.id}-label`"
                      class="px-2 pt-1.5 pb-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-50"
                    >
                      {{ section.label }}
                    </p>
                    <ul
                      class="flex flex-col gap-0.5"
                      :role="section.label ? 'group' : 'presentation'"
                      :aria-labelledby="section.label
                        ? `${section.id}-label`
                        : undefined
                      "
                    >
                      <template
                        v-for="entry in section.entries"
                        :key="entry.model.id"
                      >
                        <ChatInputModelsTriggerModelItem
                          :model="entry.model"
                          :provider-id="entry.providerId"
                          :is-selected="userModel === entry.model.id"
                          :is-highlighted="
                            highlightedModelId === entry.model.id
                          "
                          :is-favorite="favoriteModels.includes(entry.model.id)"
                          :is-detail-open="detailModelId === entry.model.id"
                          @select="selectModel(entry.model.id)"
                          @toggle-favorite="toggleFavoriteModel(entry.model.id)"
                          @toggle-detail="toggleDetail(entry.model.id)"
                        />
                        <li
                          v-if="detailModelId === entry.model.id"
                          role="presentation"
                          class="py-0.5"
                        >
                          <ChatInputModelsTriggerModelDetail
                            :model="entry.model"
                            :provider-name="entry.providerName"
                            @close="closeDetail"
                          />
                        </li>
                      </template>
                    </ul>
                  </template>
                </div>
                <div
                  v-if="legacyModels.length"
                  data-testid="models-picker-legacy"
                  class="mt-1 pt-1 border-t border-base-content/10"
                >
                  <button
                    :id="legacyLabelId"
                    type="button"
                    data-testid="models-picker-legacy-toggle"
                    class="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-xl text-[0.65rem] font-semibold uppercase tracking-wide opacity-50 cursor-pointer transition-colors hover:bg-base-content/5 hover:opacity-80"
                    :aria-expanded="isLegacyExpanded"
                    :aria-controls="legacyListId"
                    @click="toggleLegacy"
                  >
                    <Icon
                      name="lucide:chevron-right"
                      size="12"
                      class="transition-transform"
                      :class="{ 'rotate-90': isLegacyExpanded }"
                    />
                    {{ legacyLabel }}
                  </button>
                  <ul
                    v-show="isLegacyExpanded"
                    :id="legacyListId"
                    data-testid="models-picker-legacy-list"
                    role="listbox"
                    :aria-labelledby="legacyLabelId"
                    class="flex flex-col gap-0.5"
                  >
                    <template
                      v-for="entry in legacyModels"
                      :key="entry.model.id"
                    >
                      <ChatInputModelsTriggerModelItem
                        :model="entry.model"
                        :provider-id="entry.providerId"
                        is-legacy
                        :is-selected="false"
                        :is-highlighted="false"
                        :is-favorite="false"
                        :is-detail-open="detailModelId === entry.model.id"
                        @toggle-detail="toggleDetail(entry.model.id)"
                      />
                      <li
                        v-if="detailModelId === entry.model.id"
                        role="presentation"
                        class="py-0.5"
                      >
                        <ChatInputModelsTriggerModelDetail
                          :model="entry.model"
                          :provider-name="entry.providerName"
                          @close="closeDetail"
                        />
                      </li>
                    </template>
                  </ul>
                </div>
                <div
                  v-if="!filteredModels.length && !legacyModels.length"
                  data-testid="models-picker-empty"
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
                  <button
                    v-if="hasActiveFilters"
                    type="button"
                    data-testid="models-picker-clear-filters"
                    class="btn btn-ghost btn-xs rounded-full text-accent"
                    @click="clearFilters"
                  >
                    Clear filters
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import type {
  ModelCategory,
  PickerModel,
  PickerSection,
} from '~/types/models-picker'

defineProps<{
  isWebSearchEnabled: boolean
  isImageGenerationEnabled: boolean
  isReasoningEnabled: boolean
}>()

const { userModel } = useUserModel()
const { providers } = getProviders()
const { favoriteModels, toggleFavoriteModel } = useUserSetting()

const isOpen = shallowRef<boolean>(false)
const searchQuery = shallowRef<string>('')
const activeProviderId = shallowRef<string | null>(null)
const isFavoritesOnly = shallowRef<boolean>(false)
const activeCategory = shallowRef<ModelCategory | null>(null)
const detailModelId = shallowRef<string | null>(null)
const highlightedModelId = shallowRef<string | null>(null)
const isLegacyExpanded = shallowRef<boolean>(false)
const root = useTemplateRef<HTMLDivElement>('root')
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const resultsContainer = useTemplateRef<HTMLDivElement>('resultsContainer')
const panelId = useId()
const listboxId = useId()
const legacyListId = useId()
const legacyLabelId = useId()

const triggerProviderId = computed<string | null>(() => {
  return getModel(toValue(userModel)).provider?.id ?? null
})

const allModels = computed<PickerModel[]>(() => {
  return providers.flatMap((provider) => {
    return provider.models.map((model) => {
      return {
        model,
        providerId: provider.id,
        providerName: provider.name,
      }
    })
  })
})

const searchTerm = computed<string>(() => {
  return searchQuery.value.trim().toLowerCase()
})

const isSearching = computed<boolean>(() => {
  return searchTerm.value.length > 0
})

const hasFavorites = computed<boolean>(() => {
  return favoriteModels.value.length > 0
})

const isRailFilterApplied = computed<boolean>(() => {
  if (isSearching.value) {
    return false
  }

  return !!activeProviderId.value || isFavoritesOnly.value
})

const hasActiveFilters = computed<boolean>(() => {
  return activeCategory.value !== null || isRailFilterApplied.value
})

function matchesActiveFilters({ model, providerId }: PickerModel): boolean {
  const matchesSearch = !isSearching.value
    || model.name.toLowerCase().includes(searchTerm.value)

  if (!matchesSearch) {
    return false
  }

  if (
    activeCategory.value !== null
    && getModelCategory(model) !== activeCategory.value
  ) {
    return false
  }

  if (!isRailFilterApplied.value) {
    return true
  }

  if (isFavoritesOnly.value && !favoriteModels.value.includes(model.id)) {
    return false
  }

  return !activeProviderId.value || providerId === activeProviderId.value
}

const matchingModels = computed<PickerModel[]>(() => {
  return allModels.value.filter(matchesActiveFilters)
})

const filteredModels = computed<PickerModel[]>(() => {
  return matchingModels.value.filter(({ model }) => {
    return model.status !== 'deprecated'
  })
})

const legacyModels = computed<PickerModel[]>(() => {
  return matchingModels.value.filter(({ model }) => {
    return model.status === 'deprecated'
  })
})

const legacyLabel = computed<string>(() => {
  const count = legacyModels.value.length

  return `${count} legacy ${count === 1 ? 'model' : 'models'}`
})

const sections = computed<PickerSection[]>(() => {
  const favorites = filteredModels.value.filter(({ model }) => {
    return favoriteModels.value.includes(model.id)
  })
  const others = filteredModels.value.filter(({ model }) => {
    return !favoriteModels.value.includes(model.id)
  })

  if (!favorites.length || !others.length) {
    return [{ id: 'all', label: '', entries: [...favorites, ...others] }]
  }

  return [
    { id: 'favorites', label: 'Favorites', entries: favorites },
    { id: 'others', label: 'Other models', entries: others },
  ]
})

const highlightedOptionId = computed<string | undefined>(() => {
  if (!highlightedModelId.value) {
    return undefined
  }

  return `model-option-${highlightedModelId.value}`
})

const emptyMessage = computed<string>(() => {
  if (hasActiveFilters.value) {
    return 'No models match the selected filters.'
  }

  return `No models match “${searchQuery.value.trim()}”.`
})

function close() {
  isOpen.value = false
  highlightedModelId.value = null
  searchQuery.value = ''
  isLegacyExpanded.value = false
  closeDetail()
}

function toggleLegacy() {
  closeDetail()
  isLegacyExpanded.value = !isLegacyExpanded.value
}

function closeAndRestoreFocus() {
  close()
  trigger.value?.focus()
}

function toggle() {
  if (isOpen.value) {
    close()

    return
  }

  isOpen.value = true
  setHighlight(getInitialHighlight())
}

/**
 * A model deprecated after the user picked it still renders in the legacy
 * list, so highlighting it would aim `aria-activedescendant` at an option
 * outside the listbox the search input controls.
 */
function getInitialHighlight(): string | null {
  const selectedId = toValue(userModel)
  const isSelectable = filteredModels.value.some(({ model }) => {
    return model.id === selectedId
  })

  if (isSelectable) {
    return selectedId
  }

  return filteredModels.value[0]?.model.id ?? null
}

function toggleProvider(providerId: string) {
  closeDetail()
  activeProviderId.value = activeProviderId.value === providerId
    ? null
    : providerId
}

function toggleFavoritesOnly() {
  closeDetail()
  isFavoritesOnly.value = !isFavoritesOnly.value
}

function clearFilters() {
  activeCategory.value = null
  activeProviderId.value = null
  isFavoritesOnly.value = false
  searchQuery.value = ''
}

function closeDetail() {
  detailModelId.value = null
}

function toggleDetail(modelId: string) {
  detailModelId.value = detailModelId.value === modelId ? null : modelId
}

function selectModel(modelId: string) {
  userModel.value = modelId
  closeAndRestoreFocus()
}

async function scrollHighlightedIntoView() {
  await nextTick()

  if (!highlightedModelId.value) {
    return
  }

  const element = resultsContainer.value?.querySelector<HTMLElement>(
    `[id="model-option-${highlightedModelId.value}"]`,
  )

  element?.scrollIntoView?.({ block: 'nearest' })
}

/**
 * Closing the detail keeps the inline detail card from shifting rows out from
 * under the highlight while the user is arrowing through the list.
 */
function setHighlight(modelId: string | null) {
  closeDetail()
  highlightedModelId.value = modelId
  scrollHighlightedIntoView()
}

function highlightFirst() {
  setHighlight(filteredModels.value[0]?.model.id ?? null)
}

function highlightLast() {
  const models = filteredModels.value

  setHighlight(models[models.length - 1]?.model.id ?? null)
}

function moveHighlight(step: number) {
  const models = filteredModels.value

  if (!models.length) {
    return
  }

  const currentIndex = models.findIndex(({ model }) => {
    return model.id === highlightedModelId.value
  })

  const nextIndex = currentIndex === -1
    ? 0
    : (currentIndex + step + models.length) % models.length

  setHighlight(models[nextIndex]?.model.id ?? null)
}

function selectHighlighted() {
  if (!highlightedModelId.value) {
    return
  }

  selectModel(highlightedModelId.value)
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveHighlight(1)

    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveHighlight(-1)

    return
  }

  if (event.key === 'Home') {
    event.preventDefault()
    highlightFirst()

    return
  }

  if (event.key === 'End') {
    event.preventDefault()
    highlightLast()

    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    selectHighlighted()
  }
}

watch(hasFavorites, (value) => {
  if (value) {
    return
  }

  isFavoritesOnly.value = false
})

watch([searchTerm, activeCategory, activeProviderId, isFavoritesOnly], () => {
  closeDetail()
  highlightedModelId.value = filteredModels.value[0]?.model.id ?? null
})

onClickOutside(root, () => {
  if (!isOpen.value) {
    return
  }

  close()
})

onKeyStroke('Escape', () => {
  if (!isOpen.value) {
    return
  }

  if (detailModelId.value) {
    closeDetail()

    return
  }

  if (searchQuery.value) {
    searchQuery.value = ''

    return
  }

  closeAndRestoreFocus()
})
</script>
