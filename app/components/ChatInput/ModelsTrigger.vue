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
        v-if="selectedIconProviderId"
        :provider-id="selectedIconProviderId"
        class="w-4 fill-base-content/40"
      />
      <span class="block truncate text-left min-w-0">
        {{ selectedModelName }}
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
              v-if="activeGateway"
              data-testid="models-picker-gateway-banner"
              class="shrink-0 flex items-center gap-2 px-2.5 py-2 border-b border-accent/30 bg-accent/10"
            >
              <ProviderIcon
                :provider-id="activeGateway.id"
                :label="activeGateway.label"
                class="w-4 shrink-0 fill-accent"
              />
              <span
                class="grow min-w-0 truncate text-xs font-semibold text-accent"
              >
                {{ activeGateway.label }}
              </span>
              <button
                type="button"
                data-testid="models-picker-gateway-exit"
                class="btn btn-ghost btn-xs shrink-0 gap-1 rounded-full"
                @click="setProviderMode"
              >
                <Icon
                  name="lucide:arrow-left"
                  size="12"
                />
                Providers
              </button>
            </div>
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
                v-if="!activeGateway"
                v-model="activeCategory"
              />
            </div>
            <div class="flex flex-1 min-h-0">
              <ChatInputModelsTriggerProviderRail
                v-if="isRailVisible"
                :providers="railProviders"
                :active-provider-id="activeProviderId"
                :is-favorites-only="isFavoritesOnly"
                :has-favorites="hasFavorites"
                @toggle-provider="toggleProvider"
                @toggle-favorites="toggleFavoritesOnly"
              />
              <div
                ref="resultsContainer"
                class="flex-1 min-h-[14rem] overflow-y-auto p-1.5"
                :class="{ 'pb-9': !activeGateway && filteredModels.length }"
              >
                <ChatInputModelsTriggerGatewayModelList
                  v-if="activeGateway"
                  ref="gatewayList"
                  :key="activeGateway.id"
                  :gateway-id="activeGateway.id"
                  :gateway-label="activeGateway.label"
                  :search-term="searchTerm"
                  :is-favorites-only="isFavoritesOnly"
                  :favorite-model-ids="activeGatewayFavorites"
                  :selected-model-id="selectedGatewayModelId"
                  :detail-model-id="detailModelId"
                  :listbox-id="listboxId"
                  @select="selectGatewayModel"
                  @toggle-favorite="toggleGatewayFavorite"
                  @toggle-detail="toggleDetail"
                  @close-detail="closeDetail"
                  @highlight="onGatewayHighlight"
                  @pending-change="onGatewayPendingChange"
                />
                <template v-else>
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
                            :is-selected="
                              selectedProviderModelId === entry.model.id
                            "
                            :is-highlighted="
                              highlightedModelId === entry.model.id
                            "
                            :is-favorite="
                              favoriteModels.includes(entry.model.id)
                            "
                            :is-detail-open="detailModelId === entry.model.id"
                            @select="selectModel(entry.model.id)"
                            @toggle-favorite="
                              toggleFavoriteModel(entry.model.id)
                            "
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
                </template>
              </div>
            </div>
            <ChatInputModelsTriggerGatewayRail
              :gateways="gatewayRailItems"
              :active-gateway-id="activeGateway?.id ?? null"
              :is-pending="isGatewayCatalogPending"
              @toggle-gateway="toggleGateway"
            />
          </div>
        </div>
      </Transition>
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import type { GatewayId } from '#shared/types/gateways.d'
import type { Providers } from '#shared/types/providers.d'
import type {
  ModelCategory,
  PickerMode,
  PickerModel,
  PickerSection,
} from '~/types/models-picker'
import { enabledGateways, providerMeta } from '#shared/utils/provider-meta'

interface GatewayListHandle {
  moveHighlight: (step: number) => void
  highlightFirst: () => void
  highlightLast: () => void
  selectHighlighted: () => void
}

defineProps<{
  isWebSearchEnabled: boolean
  isImageGenerationEnabled: boolean
  isReasoningEnabled: boolean
}>()

const { selection } = useUserModel()
const { providers } = getProviders()
const {
  favoriteModels,
  toggleFavoriteModel,
  getFavoriteGatewayModels,
  toggleFavoriteGatewayModel,
} = useUserSetting()
const {
  name: selectedModelName,
  iconProviderId: selectedIconProviderId,
} = useSelectedModelInfo()

const pickerMode = shallowRef<PickerMode>({ source: 'provider' })
const gatewayHighlightedOptionId = shallowRef<string | null>(null)
const isGatewayCatalogPending = shallowRef<boolean>(false)
const gatewayList = useTemplateRef<GatewayListHandle>('gatewayList')
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

const gatewayRailItems = computed(() => {
  return enabledGateways.map((gatewayId) => {
    return {
      id: gatewayId,
      label: providerMeta[gatewayId]?.label ?? gatewayId,
    }
  })
})

/**
 * Null whenever the picker is browsing the curated catalog, which includes a
 * stored selection pointing at a gateway that is not enabled yet — that falls
 * back to provider mode rather than rendering a rail button nothing can serve.
 */
const activeGateway = computed(() => {
  const mode = pickerMode.value

  if (mode.source !== 'gateway') {
    return null
  }

  return gatewayRailItems.value.find((item) => {
    return item.id === mode.gatewayId
  }) ?? null
})

const activeGatewayFavorites = computed<string[]>(() => {
  const gateway = activeGateway.value

  return gateway ? getFavoriteGatewayModels(gateway.id) : []
})

const selectedProviderModelId = computed<string | null>(() => {
  const current = selection.value

  return current.source === 'provider' ? current.modelId : null
})

const selectedGatewayModelId = computed<string | null>(() => {
  const gateway = activeGateway.value
  const current = selection.value

  if (
    !gateway
    || current.source !== 'gateway'
    || current.gatewayId !== gateway.id
  ) {
    return null
  }

  return current.modelId
})

const railProviders = computed<Providers>(() => {
  return activeGateway.value ? [] : providers
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
  if (activeGateway.value) {
    return activeGatewayFavorites.value.length > 0
  }

  return favoriteModels.value.length > 0
})

const isRailVisible = computed<boolean>(() => {
  if (isSearching.value) {
    return false
  }

  if (activeGateway.value) {
    return hasFavorites.value
  }

  return true
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
  if (activeGateway.value) {
    return gatewayHighlightedOptionId.value ?? undefined
  }

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
  gatewayHighlightedOptionId.value = null
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

/**
 * Re-derived on every open rather than once at setup: the picker mounts with
 * the chat input and stays mounted, so a selection made elsewhere would leave
 * setup-time mode state stale.
 */
function getModeFromSelection(): PickerMode {
  const current = selection.value

  if (
    current.source !== 'gateway'
    || !enabledGateways.includes(current.gatewayId)
  ) {
    return { source: 'provider' }
  }

  return { source: 'gateway', gatewayId: current.gatewayId }
}

function toggle() {
  if (isOpen.value) {
    close()

    return
  }

  pickerMode.value = getModeFromSelection()
  isOpen.value = true

  if (activeGateway.value) {
    return
  }

  setHighlight(getInitialHighlight())
}

function switchMode(mode: PickerMode) {
  pickerMode.value = mode
  isGatewayCatalogPending.value = false
  gatewayHighlightedOptionId.value = null
  searchQuery.value = ''
  activeCategory.value = null
  activeProviderId.value = null
  isFavoritesOnly.value = false
  isLegacyExpanded.value = false
  highlightedModelId.value = null
  closeDetail()

  if (mode.source === 'gateway') {
    return
  }

  setHighlight(getInitialHighlight())
}

function setProviderMode() {
  switchMode({ source: 'provider' })
}

function toggleGateway(gatewayId: GatewayId) {
  switchMode(
    activeGateway.value?.id === gatewayId
      ? { source: 'provider' }
      : { source: 'gateway', gatewayId },
  )
}

/**
 * A model deprecated after the user picked it still renders in the legacy
 * list, so highlighting it would aim `aria-activedescendant` at an option
 * outside the listbox the search input controls.
 */
function getInitialHighlight(): string | null {
  const selectedId = selectedProviderModelId.value
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
  selection.value = { source: 'provider', modelId }
  closeAndRestoreFocus()
}

function selectGatewayModel(modelId: string) {
  const gateway = activeGateway.value

  if (!gateway) {
    return
  }

  selection.value = { source: 'gateway', gatewayId: gateway.id, modelId }
  closeAndRestoreFocus()
}

function toggleGatewayFavorite(modelId: string) {
  const gateway = activeGateway.value

  if (!gateway) {
    return
  }

  toggleFavoriteGatewayModel(gateway.id, modelId)
}

function onGatewayHighlight(optionId: string | null) {
  gatewayHighlightedOptionId.value = optionId
}

function onGatewayPendingChange(isPending: boolean) {
  isGatewayCatalogPending.value = isPending
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

function moveHighlightInActiveList(step: number) {
  const list = gatewayList.value

  if (list) {
    list.moveHighlight(step)

    return
  }

  moveHighlight(step)
}

function highlightFirstInActiveList() {
  const list = gatewayList.value

  if (list) {
    list.highlightFirst()

    return
  }

  highlightFirst()
}

function highlightLastInActiveList() {
  const list = gatewayList.value

  if (list) {
    list.highlightLast()

    return
  }

  highlightLast()
}

function selectHighlightedInActiveList() {
  const list = gatewayList.value

  if (list) {
    list.selectHighlighted()

    return
  }

  selectHighlighted()
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveHighlightInActiveList(1)

    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveHighlightInActiveList(-1)

    return
  }

  if (event.key === 'Home') {
    event.preventDefault()
    highlightFirstInActiveList()

    return
  }

  if (event.key === 'End') {
    event.preventDefault()
    highlightLastInActiveList()

    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    selectHighlightedInActiveList()
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

  if (activeGateway.value) {
    return
  }

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
