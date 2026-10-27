<template>
  <div
    class="flex flex-col"
    :class="isSheet ? 'flex-1 min-h-0' : POPOVER_ROOT_CLASS"
  >
    <ChatInputModelsTriggerKeyPrompt
      v-if="keyBanner"
      compact
      :layout="layout"
      :test-id="keyBanner.testId"
      :title="keyBanner.title"
      :description="keyBanner.description"
      :action-label="keyBanner.actionLabel"
      :to="keyBanner.to"
      @navigate="emit('close', { restoreFocus: false })"
    />
    <div
      v-if="activeGateway"
      data-testid="models-picker-gateway-banner"
      class="shrink-0 flex items-center gap-2 px-2.5 py-2 border-b border-accent/30 bg-accent/10"
      :class="{ 'rounded-t-2xl': !keyBanner && !isSheet }"
    >
      <ProviderIcon
        :provider-id="activeGateway.id"
        :label="activeGateway.label"
        class="!size-4 shrink-0 text-accent"
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
      v-if="!isActiveGatewayKeyless"
      data-testid="models-picker-search-row"
      class="shrink-0 flex items-center gap-1 p-2 border-b border-base-content/10"
    >
      <ChatInputModelsTriggerSearch
        ref="search"
        v-model="searchQuery"
        :autofocus="isDesktop && !isSheet"
        :controls="listboxId"
        :active-descendant="highlightedOptionId"
        class="grow min-w-0"
        @keydown="onSearchKeydown"
      />
      <button
        v-if="!recommendedFilter && isSheet"
        type="button"
        data-testid="models-picker-filter-trigger"
        class="btn btn-ghost btn-sm btn-circle relative shrink-0"
        :class="{
          'text-accent': hasActiveMenuFilter,
          'btn-active': isFilterSectionOpen
        }"
        aria-label="Filter models by category"
        :aria-expanded="isFilterSectionOpen"
        :aria-controls="isFilterSectionOpen ? filterSectionId : undefined"
        @click="toggleFilterSection"
      >
        <Icon
          name="lucide:list-filter"
          size="16"
        />
        <span
          v-if="hasActiveMenuFilter"
          aria-hidden="true"
          class="badge badge-xs badge-accent absolute -top-0.5 -right-0.5"
        />
      </button>
      <ChatInputModelsTriggerFilterDropdown
        v-else-if="!recommendedFilter"
        v-model="activeCategory"
        v-model:vision-only="isVisionOnly"
        v-model:capabilities="activeCapabilityFilters"
        :options="filterCategoryOptions"
        :capability-options="filterCapabilityOptions"
      />
      <div
        v-else
        role="group"
        aria-label="Model list"
        data-testid="models-picker-recommended-filter"
        class="join shrink-0"
      >
        <button
          type="button"
          data-testid="memory-picker-filter-all"
          class="btn btn-xs join-item"
          :class="{ 'btn-active btn-neutral': !isRecommendedOnly }"
          :aria-pressed="!isRecommendedOnly"
          @click="setRecommendedOnly(false)"
        >
          All
        </button>
        <button
          type="button"
          data-testid="memory-picker-filter-recommended"
          class="btn btn-xs join-item"
          :class="{ 'btn-active btn-neutral': isRecommendedOnly }"
          :aria-pressed="isRecommendedOnly"
          @click="setRecommendedOnly(true)"
        >
          Recommended
        </button>
      </div>
    </div>
    <ChatInputModelsTriggerFilterSection
      v-if="isSheet && isFilterSectionOpen && !recommendedFilter"
      :id="filterSectionId"
      v-model="activeCategory"
      v-model:vision-only="isVisionOnly"
      v-model:capabilities="activeCapabilityFilters"
      :options="filterCategoryOptions"
      :capability-options="filterCapabilityOptions"
    />
    <div
      class="flex flex-1 min-h-0"
      :class="{ 'flex-col': isSheet }"
    >
      <ChatInputModelsTriggerProviderRail
        v-if="isRailVisible"
        :layout="layout"
        :providers="providers"
        :active-provider-id="activeProviderId"
        :is-favorites-only="isFavoritesOnly"
        :has-favorites="hasFavorites"
        :keyless-provider-ids="keylessProviderIds"
        @toggle-provider="toggleProvider"
        @toggle-favorites="toggleFavoritesOnly"
      />
      <ChatInputModelsTriggerGatewayProviderRail
        v-if="isGatewayProviderRailVisible"
        :layout="layout"
        :providers="gatewayProviderGroups"
        :active-provider-prefix="activeGatewayProviderPrefix"
        :is-favorites-only="isFavoritesOnly"
        :has-favorites="hasFavorites"
        @toggle-provider="toggleGatewayProvider"
        @toggle-favorites="toggleFavoritesOnly"
      />
      <div
        ref="resultsContainer"
        data-testid="models-picker-results"
        class="flex-1 overflow-y-auto p-1.5"
        :class="{
          'pb-9': !activeGateway && filteredModels.length,
          'min-h-[14rem]': !isSheet,
          'min-h-0 overscroll-contain': isSheet
        }"
        :style="isSheet ? resultsFadeStyle : undefined"
      >
        <ChatInputModelsTriggerKeyPrompt
          v-if="isActiveGatewayKeyless"
          hide-action
          :title="activeGatewayPrompt.title"
          :description="activeGatewayPrompt.description"
        />
        <ChatInputModelsTriggerGatewayModelList
          v-else-if="activeGateway"
          ref="gatewayList"
          :key="activeGateway.id"
          :gateway-id="activeGateway.id"
          :gateway-label="activeGateway.label"
          :search-term="searchTerm"
          :is-favorites-only="isFavoritesOnly"
          :is-free-only="isFreeOnly"
          :is-vision-only="isVisionOnly"
          :capability-filters="activeCapabilityFilters"
          :active-provider-prefix="activeGatewayProviderPrefix"
          :favorite-model-ids="activeGatewayFavorites"
          :selected-model-id="selectedGatewayModelId"
          :detail-model-id="detailModelId"
          :listbox-id="listboxId"
          :filter-model="filterGatewayModel"
          :recommended-direct-models="recommendedDirectModels"
          :recommended-only="isRecommendedOnly"
          @select="selectGatewayModel"
          @toggle-favorite="toggleGatewayFavorite"
          @toggle-detail="toggleDetail"
          @close-detail="closeDetail"
          @clear-filters="clearFilters"
          @highlight="onGatewayHighlight"
          @pending-change="onGatewayPendingChange"
          @provider-groups-change="onGatewayProviderGroupsChange"
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
                    :provider-name="entry.providerName"
                    :is-key-missing="
                      isModelKeyMissing(entry.providerId)
                    "
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
                    :is-recommended="
                      recommendedModelIds.includes(entry.model.id)
                    "
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
                      :is-key-missing="
                        isModelKeyMissing(entry.providerId)
                      "
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
              :aria-controls="
                isLegacyExpanded ? legacyListId : undefined
              "
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
              v-if="isLegacyExpanded"
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
      :layout="layout"
      :gateways="gatewayRailItems"
      :active-gateway-id="activeGateway?.id ?? null"
      :is-pending="isGatewayCatalogPending"
      @toggle-gateway="toggleGateway"
    />
  </div>
</template>

<script setup lang="ts">
import type { GatewayId, GatewayModel } from '#shared/types/gateways.d'
import type { Model, ModelTool } from '#shared/types/providers.d'
import type {
  GatewayCapabilityFilter,
  GatewayCapabilityFilterOption,
  GatewayProviderGroup,
  ModelCategory,
  ModelCategoryOption,
  PickerLayout,
  PickerMode,
  PickerModel,
  PickerSection,
} from '~/types/models-picker'
import { isGatewayToolAllowed } from '#shared/utils/gateway-capabilities'
import type { RecommendedDirectModel } from '#shared/utils/memory-recommended-models'
import { enabledGateways, providerMeta } from '#shared/utils/provider-meta'

const POPOVER_ROOT_CLASS = 'bubble-without-background max-h-[60dvh] bg-base-100 border border-base-content/10 shadow-xl'

const GATEWAY_CAPABILITY_FILTER_TOOLS: Partial<
  Record<GatewayCapabilityFilter, ModelTool>
> = {
  'web-search': 'web_search',
  'image-generation': 'image_generation',
}

interface KeyBanner {
  testId: string
  title: string
  description: string
  actionLabel: string
  to: string
}

interface GatewayListHandle {
  moveHighlight: (step: number) => void
  highlightFirst: () => void
  highlightLast: () => void
  selectHighlighted: () => void
  resetHighlight: () => void
}

const props = withDefaults(defineProps<{
  isOpen: boolean
  selectedModelId: string | null
  selectedGatewayId: GatewayId | null
  filterModel?: (model: Model) => boolean
  filterGatewayModel?: (model: GatewayModel) => boolean
  recommendedModelIds?: string[]
  recommendedFilter?: boolean
  layout?: PickerLayout
}>(), {
  filterModel: undefined,
  filterGatewayModel: undefined,
  recommendedModelIds: () => [],
  recommendedFilter: false,
  layout: 'popover',
})

const emit = defineEmits<{
  select: [selection: { modelId: string, gatewayId: GatewayId | null }]
  close: [options: { restoreFocus: boolean }]
}>()

const { providers } = getProviders()
const {
  favoriteModels,
  toggleFavoriteModel,
  getFavoriteGatewayModels,
  toggleFavoriteGatewayModel,
} = useUserSetting()
const { hasKeyForProvider, hasAnyKey } = useUserKeys()
const { isDesktop } = useDevice()

const pickerMode = shallowRef<PickerMode>(getModeFromSelection())
const gatewayHighlightedOptionId = shallowRef<string | null>(null)
const gatewayProviderGroups = shallowRef<GatewayProviderGroup[]>([])
const activeGatewayProviderPrefix = shallowRef<string | null>(null)
const isGatewayCatalogPending = shallowRef<boolean>(false)
const gatewayList = useTemplateRef<GatewayListHandle>('gatewayList')
const searchQuery = shallowRef<string>('')
const activeProviderId = shallowRef<string | null>(null)
const isFavoritesOnly = shallowRef<boolean>(false)
const activeCategory = shallowRef<ModelCategory | null>(null)
const isVisionOnly = shallowRef<boolean>(false)
const isRecommendedOnly = shallowRef<boolean>(false)
const activeCapabilityFilters = shallowRef<GatewayCapabilityFilter[]>([])
const detailModelId = shallowRef<string | null>(null)
const highlightedModelId = shallowRef<string | null>(null)
const isLegacyExpanded = shallowRef<boolean>(false)
const isFilterSectionOpen = shallowRef<boolean>(false)
const search = useTemplateRef<{ focus: () => void }>('search')
const resultsContainer = useTemplateRef<HTMLDivElement>('resultsContainer')
const { fadeStyle: resultsFadeStyle } = useScrollEdgeFade(resultsContainer)
const listboxId = useId()
const filterSectionId = useId()
const legacyListId = useId()
const legacyLabelId = useId()

/**
 * `hasKeyForProvider` maps the `GatewayId` through `providerMeta` to the
 * `keys.provider` enum value it is stored under — `vercel` lives in the table
 * as `vercel-gateway`, so the bare id must never reach a key lookup.
 */
const gatewayRailItems = computed(() => {
  return enabledGateways.map((gatewayId) => {
    return {
      id: gatewayId,
      label: providerMeta[gatewayId]?.label ?? gatewayId,
      hasKey: hasKeyForProvider(gatewayId),
    }
  })
})

const keylessProviderIds = computed<string[]>(() => {
  return providers
    .filter((provider) => {
      return !hasKeyForProvider(provider.id)
    })
    .map((provider) => {
      return provider.id
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

const isActiveGatewayKeyless = computed<boolean>(() => {
  return activeGateway.value?.hasKey === false
})

const activeGatewayPrompt = computed(() => {
  const label = activeGateway.value?.label ?? 'This gateway'

  return {
    title: `${label} models`,
    description: `Add your ${label} key to browse them here.`,
  }
})

/**
 * The `/profile/keys?provider=` deep link opens and scrolls to that provider's
 * card, where its "How to get a key" guide lives. A gateway id is also a
 * `providerMeta` id, so the same link shape serves both modes.
 */
function getKeysLink(providerId: string | null): string {
  return providerId
    ? `/profile/keys?provider=${providerId}`
    : '/profile/keys'
}

const selectedRailProvider = computed(() => {
  if (!isRailFilterApplied.value || !activeProviderId.value) {
    return null
  }

  return providers.find((provider) => {
    return provider.id === activeProviderId.value
  }) ?? null
})

const keyBanner = computed<KeyBanner | null>(() => {
  const gateway = activeGateway.value

  if (gateway) {
    if (!isActiveGatewayKeyless.value) {
      return null
    }

    return {
      testId: 'models-picker-gateway-key-banner',
      title: `${gateway.label} needs a key`,
      description: 'Add one to browse its models.',
      actionLabel: 'Add key',
      to: getKeysLink(gateway.id),
    }
  }

  const provider = selectedRailProvider.value

  if (!hasAnyKey.value) {
    return {
      testId: 'models-picker-key-banner',
      title: 'No API keys yet',
      description: 'Besidka runs on your own keys. Add one to start.',
      actionLabel: 'Add a key',
      to: getKeysLink(provider?.id ?? null),
    }
  }

  if (!provider || hasKeyForProvider(provider.id)) {
    return null
  }

  const label = providerMeta[provider.id]?.shortLabel
    ?? providerMeta[provider.id]?.label
    ?? provider.name

  return {
    testId: 'models-picker-provider-key-banner',
    title: `No ${label} key yet`,
    description: 'Add one to use these models.',
    actionLabel: 'Add key',
    to: getKeysLink(provider.id),
  }
})

const activeGatewayFavorites = computed<string[]>(() => {
  const gateway = activeGateway.value

  return gateway ? getFavoriteGatewayModels(gateway.id) : []
})

const selectedProviderModelId = computed<string | null>(() => {
  return props.selectedGatewayId === null ? props.selectedModelId : null
})

const selectedGatewayModelId = computed<string | null>(() => {
  const gateway = activeGateway.value

  if (!gateway || props.selectedGatewayId !== gateway.id) {
    return null
  }

  return props.selectedModelId
})

/**
 * `filterModel` runs before every other filter, so a caller-hidden model
 * never reaches the sections, the legacy list or the keyboard highlight.
 */
const allModels = computed<PickerModel[]>(() => {
  const entries = providers.flatMap((provider) => {
    return provider.models.map((model) => {
      return {
        model,
        providerId: provider.id,
        providerName: provider.name,
      }
    })
  })
  const { filterModel } = props

  if (!filterModel) {
    return entries
  }

  return entries.filter(({ model }) => {
    return filterModel(model)
  })
})

/**
 * Gateway ids never match the curated ids, so a gateway model is recommended
 * through the direct models flagged here, paired with their provider so the
 * vendor on a gateway id can be compared (`memory-recommended-models.ts`).
 */
const recommendedDirectModels = computed<RecommendedDirectModel[]>(() => {
  if (!props.recommendedModelIds.length) {
    return []
  }

  return providers.flatMap((provider) => {
    return provider.models
      .filter((model) => {
        return props.recommendedModelIds.includes(model.id)
      })
      .map((model) => {
        return { providerId: provider.id, modelId: model.id }
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

/**
 * Provider mode only. A gateway hands its vendor separation to
 * `GatewayProviderRail.vue`, which carries the favorites filter for that mode
 * so the panel never stacks two rails against the same left edge.
 */
const isRailVisible = computed<boolean>(() => {
  return !isSearching.value && !activeGateway.value
})

const isRailFilterApplied = computed<boolean>(() => {
  if (isSearching.value) {
    return false
  }

  return !!activeProviderId.value || isFavoritesOnly.value
})

const isSheet = computed<boolean>(() => {
  return props.layout === 'sheet'
})

const hasActiveMenuFilter = computed<boolean>(() => {
  return activeCategory.value !== null
    || isVisionOnly.value
    || activeCapabilityFilters.value.length > 0
})

const hasActiveFilters = computed<boolean>(() => {
  return activeCategory.value !== null
    || isVisionOnly.value
    || isRecommendedOnly.value
    || activeCapabilityFilters.value.length > 0
    || isRailFilterApplied.value
    || !!activeGatewayProviderPrefix.value
})

/**
 * A gateway catalog carries none of the curated chat/research/image-generation
 * classification the direct options filter on, so the two modes offer
 * different categories through the same control rather than showing one that
 * can only ever match nothing.
 */
const filterCategoryOptions = computed<ModelCategoryOption[]>(() => {
  return activeGateway.value
    ? gatewayModelCategoryOptions
    : modelCategoryOptions
})

/**
 * Hides a policy-gated option for a gateway whose send path can never carry
 * that tool (Cloudflare allows neither web search nor image generation) —
 * offering a filter no model could ever match would be a dead control.
 */
const filterCapabilityOptions
  = computed<GatewayCapabilityFilterOption[]>(() => {
    const gateway = activeGateway.value

    if (!gateway) {
      return []
    }

    return gatewayCapabilityFilterOptions.filter((option) => {
      const tool = GATEWAY_CAPABILITY_FILTER_TOOLS[option.value]

      return !tool || isGatewayToolAllowed(gateway.id, tool)
    })
  })

const isFreeOnly = computed<boolean>(() => {
  return activeCategory.value === 'free'
})

/**
 * A single-provider catalog has nothing to filter by — this only happens
 * when a gateway's real vendor prefixes collapse to one distinct value
 * after `getGatewayModelProviderPrefix()` (Cloudflare vendor extraction was
 * fixed in `shared/utils/gateway-model-id.ts`, so it now reports each
 * `@cf/vendor/...` model's real vendor instead of the shared `@cf`
 * namespace). The favorites filter alone still earns the rail, which is what
 * the provider-mode rail rendered here before the vendors joined it.
 */
const isGatewayProviderRailVisible = computed<boolean>(() => {
  if (
    !activeGateway.value
    || isActiveGatewayKeyless.value
    || isSearching.value
  ) {
    return false
  }

  return gatewayProviderGroups.value.length > 1 || hasFavorites.value
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

  if (isVisionOnly.value && !hasVisionCapability(model)) {
    return false
  }

  if (
    isRecommendedOnly.value
    && !props.recommendedModelIds.includes(model.id)
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

function isModelKeyMissing(providerId: string): boolean {
  return keylessProviderIds.value.includes(providerId)
}

/**
 * Keyboard navigation and Enter-to-choose run over this list, not over
 * `filteredModels`: a keyless row is rendered but not selectable, so letting
 * the highlight land on one would hand the user an Enter key that silently
 * does nothing. Empty in gateway mode, which keeps the curated catalog out of
 * reach of the arrow keys while a gateway owns the panel — including when a
 * keyless gateway replaces the model list entirely and there is no gateway
 * list handle to delegate to.
 */
const selectableModels = computed<PickerModel[]>(() => {
  if (activeGateway.value) {
    return []
  }

  return filteredModels.value.filter(({ providerId }) => {
    return !isModelKeyMissing(providerId)
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

/**
 * Runs at the start of every open and on `@after-leave` — a reopen mid-fade
 * never fires `after-leave`. Leaves `gatewayHighlightedOptionId` alone; that
 * belongs to the gateway list's own `resetHighlight()`.
 */
function resetTransientState() {
  searchQuery.value = ''
  activeCategory.value = null
  isVisionOnly.value = false
  isRecommendedOnly.value = false
  activeCapabilityFilters.value = []
  isLegacyExpanded.value = false
  isFilterSectionOpen.value = false
  highlightedModelId.value = null
  closeDetail()
}

function toggleFilterSection() {
  isFilterSectionOpen.value = !isFilterSectionOpen.value
}

function setRecommendedOnly(value: boolean) {
  isRecommendedOnly.value = value
}

function toggleLegacy() {
  closeDetail()
  isLegacyExpanded.value = !isLegacyExpanded.value
}

/**
 * Re-derived on every open rather than once at setup: the picker mounts with
 * the chat input and stays mounted, so a selection made elsewhere would leave
 * setup-time mode state stale.
 */
function getModeFromSelection(): PickerMode {
  const gatewayId = props.selectedGatewayId

  if (gatewayId === null || !enabledGateways.includes(gatewayId)) {
    return { source: 'provider' }
  }

  return { source: 'gateway', gatewayId }
}

/**
 * The gateway branch awaits a tick before `resetHighlight()`: on the first
 * open the list hasn't mounted yet, so its template ref isn't populated
 * until Vue finishes patching the DOM. `focusSearch()` runs fire-and-forget
 * only after the highlight is set, so focus lands once
 * `aria-activedescendant` already names the reopened selection. A panel
 * mounted with `isOpen` already true runs this from setup, so its caller
 * only calls it for each later open.
 */
async function prepareOpen() {
  resetTransientState()
  pickerMode.value = getModeFromSelection()

  if (activeGateway.value) {
    await nextTick()
    gatewayList.value?.resetHighlight()
  } else {
    setHighlight(getInitialHighlight())
  }

  focusSearch()
}

/**
 * The sheet never takes focus into the search: the iOS keyboard would cover
 * most of the list before the user has seen it.
 */
async function focusSearch() {
  await nextTick()

  if (!isDesktop || isSheet.value) {
    return
  }

  search.value?.focus()
}

function switchMode(mode: PickerMode) {
  pickerMode.value = mode
  isGatewayCatalogPending.value = false
  gatewayHighlightedOptionId.value = null
  gatewayProviderGroups.value = []
  activeGatewayProviderPrefix.value = null
  searchQuery.value = ''
  activeCategory.value = null
  isVisionOnly.value = false
  isRecommendedOnly.value = false
  activeCapabilityFilters.value = []
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
  const isSelectable = selectableModels.value.some(({ model }) => {
    return model.id === selectedId
  })

  if (isSelectable) {
    return selectedId
  }

  return selectableModels.value[0]?.model.id ?? null
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
  isVisionOnly.value = false
  isRecommendedOnly.value = false
  activeCapabilityFilters.value = []
  activeProviderId.value = null
  activeGatewayProviderPrefix.value = null
  isFavoritesOnly.value = false
  searchQuery.value = ''
}

function toggleGatewayProvider(prefix: string) {
  closeDetail()
  activeGatewayProviderPrefix.value
    = activeGatewayProviderPrefix.value === prefix ? null : prefix
}

/**
 * A prefix the narrowed catalog no longer offers — the free filter, the
 * vision filter or a favorites-only view can drop one entirely — would
 * otherwise keep filtering the list down to nothing with no chip left to
 * switch it off.
 */
function onGatewayProviderGroupsChange(groups: GatewayProviderGroup[]) {
  gatewayProviderGroups.value = groups

  const isActiveStillOffered = groups.some((group) => {
    return group.prefix === activeGatewayProviderPrefix.value
  })

  if (isActiveStillOffered) {
    return
  }

  activeGatewayProviderPrefix.value = null
}

function closeDetail() {
  detailModelId.value = null
}

function toggleDetail(modelId: string) {
  detailModelId.value = detailModelId.value === modelId ? null : modelId
}

function selectModel(modelId: string) {
  const entry = allModels.value.find(({ model }) => {
    return model.id === modelId
  })

  if (entry && isModelKeyMissing(entry.providerId)) {
    return
  }

  emit('select', { modelId, gatewayId: null })
}

function selectGatewayModel(modelId: string) {
  const gateway = activeGateway.value

  if (!gateway || gateway.hasKey === false) {
    return
  }

  emit('select', { modelId, gatewayId: gateway.id })
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
  setHighlight(selectableModels.value[0]?.model.id ?? null)
}

function highlightLast() {
  const models = selectableModels.value

  setHighlight(models[models.length - 1]?.model.id ?? null)
}

function moveHighlight(step: number) {
  const models = selectableModels.value

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

if (props.isOpen) {
  prepareOpen()
}

watch(hasFavorites, (value) => {
  if (value) {
    return
  }

  isFavoritesOnly.value = false
})

watch([
  searchTerm,
  activeCategory,
  isVisionOnly,
  isRecommendedOnly,
  activeCapabilityFilters,
  activeProviderId,
  isFavoritesOnly,
], () => {
  closeDetail()

  if (!props.isOpen || activeGateway.value) {
    return
  }

  highlightedModelId.value = selectableModels.value[0]?.model.id ?? null
})

/**
 * Unwinds one layer of transient state, innermost first. Returns false when
 * there is nothing left, so the caller closes the picker instead.
 */
function handleEscape(): boolean {
  if (detailModelId.value) {
    closeDetail()

    return true
  }

  if (isFilterSectionOpen.value) {
    isFilterSectionOpen.value = false

    return true
  }

  if (searchQuery.value) {
    searchQuery.value = ''

    return true
  }

  return false
}

onKeyStroke('Escape', () => {
  if (!props.isOpen || isSheet.value) {
    return
  }

  if (handleEscape()) {
    return
  }

  emit('close', { restoreFocus: true })
})

defineExpose({
  prepareOpen,
  resetTransientState,
  handleEscape,
})
</script>
