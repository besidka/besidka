<template>
  <li
    :id="optionId"
    role="option"
    :aria-selected="isSelected"
  >
    <div
      class="flex items-center gap-1 rounded-xl pl-2 pr-1 py-1 transition-colors"
      :class="{
        'bg-accent/15': isSelected,
        'bg-base-content/10': isHighlighted && !isSelected,
        'hover:bg-base-content/5': !isSelected && !isHighlighted
      }"
    >
      <button
        type="button"
        :aria-label="`Choose ${model.name}`"
        class="grow min-w-0 flex flex-wrap xs:flex-nowrap items-center gap-x-2 gap-y-1 py-1 text-left cursor-pointer"
        @click="emit('select')"
      >
        <span class="w-full xs:w-auto min-w-0 flex items-center gap-1.5">
          <ProviderIcon
            :provider-id="providerPrefix"
            :label="providerPrefix"
            class="w-3.5 shrink-0 fill-base-content/40"
          />
          <span
            class="truncate text-sm font-medium"
            :class="{ 'text-accent': isSelected }"
          >
            {{ model.name }}
          </span>
        </span>
        <span
          v-if="isFree"
          data-testid="gateway-model-free"
          class="badge badge-xs badge-soft badge-success shrink-0 gap-1 font-semibold max-xs:ml-5"
        >
          <Icon
            name="lucide:banknote-x"
            size="10"
          />
          Free
        </span>
        <span
          v-else-if="priceTier"
          data-testid="gateway-model-price-tier"
          class="badge badge-xs badge-soft shrink-0 font-semibold tooltip tooltip-soft tooltip-bottom max-xs:ml-5"
          :class="getPriceTierClass(priceTier)"
          :data-tip="priceTip"
        >
          {{ priceTier }}
          <span
            v-if="priceTip"
            class="sr-only"
          >
            {{ priceTip }}
          </span>
        </span>
        <span
          v-if="hasCapabilities"
          data-testid="gateway-model-capabilities"
          class="shrink-0 flex gap-1 items-center xs:ml-auto"
          :class="{
            'max-xs:ml-5': !hasPriceBadge,
            'max-xs:-ml-1': hasPriceBadge
          }"
        >
          <span
            v-if="model.supportsReasoning"
            data-testid="gateway-model-reasoning-capability"
            class="capability-chip shrink-0 flex items-center p-0.5 rounded-full text-warning"
            :class="{ 'tooltip tooltip-soft tooltip-bottom': isDesktop }"
            data-tip="Reasoning"
          >
            <Icon name="lucide:brain" />
          </span>
          <span
            v-if="model.supportsWebSearch"
            data-testid="gateway-model-web-search-capability"
            class="capability-chip shrink-0 flex items-center p-0.5 rounded-full text-info"
            :class="{ 'tooltip tooltip-soft tooltip-bottom': isDesktop }"
            data-tip="Web search"
          >
            <Icon name="lucide:globe" />
          </span>
          <span
            v-if="supportsImageInput"
            data-testid="gateway-model-image-input-capability"
            class="capability-chip shrink-0 flex items-center p-0.5 rounded-full text-violet-700 dark:text-violet-200"
            :class="{ 'tooltip tooltip-soft tooltip-bottom': isDesktop }"
            data-tip="Image input"
          >
            <Icon name="lucide:image" />
          </span>
        </span>
      </button>
      <span
        data-testid="gateway-model-actions"
        class="shrink-0 flex items-center gap-1 max-xs:flex-col"
      >
        <button
          type="button"
          data-testid="gateway-model-info-trigger"
          class="btn btn-ghost btn-xs btn-circle shrink-0 max-xs:[--size:calc(var(--size-field)_*_7)] hitslop"
          :class="{ 'text-accent': isDetailOpen, 'btn-active': isDetailOpen }"
          :aria-label="`About ${model.name}`"
          :aria-expanded="isDetailOpen"
          :aria-controls="isDetailOpen ? detailId : undefined"
          @click.stop="emit('toggleDetail')"
        >
          <Icon
            name="lucide:info"
            size="14"
          />
        </button>
        <button
          type="button"
          data-testid="gateway-model-favorite-toggle"
          class="btn btn-ghost btn-xs btn-circle shrink-0 max-xs:[--size:calc(var(--size-field)_*_7)] tooltip tooltip-left"
          :class="{ 'text-warning': isFavorite }"
          :aria-label="isFavorite
            ? `Remove ${model.name} from favorites`
            : `Add ${model.name} to favorites`
          "
          :aria-pressed="isFavorite"
          :data-tip="isFavorite
            ? 'Remove from favorites'
            : 'Add to favorites'
          "
          @click.stop="emit('toggleFavorite')"
        >
          <Icon
            name="lucide:star"
            mode="svg"
            size="14"
            :class="{ '[&_path]:fill-current': isFavorite }"
          />
        </button>
      </span>
    </div>
  </li>
</template>

<script setup lang="ts">
import type { GatewayModel } from '#shared/types/gateways.d'
import type { ModelPriceTier } from '#shared/types/providers.d'
import { getGatewayModelProviderPrefix } from '#shared/utils/gateway-model-id'
import {
  isGatewayModelFree,
  resolveGatewayPriceTier,
} from '#shared/utils/gateway-pricing'

const props = defineProps<{
  model: GatewayModel
  isSelected: boolean
  isHighlighted: boolean
  isFavorite: boolean
  isDetailOpen: boolean
}>()

const emit = defineEmits<{
  select: []
  toggleFavorite: []
  toggleDetail: []
}>()

const { isDesktop } = useDevice()

const providerPrefix = computed<string>(() => {
  return getGatewayModelProviderPrefix(props.model.id)
})

const isFree = computed<boolean>(() => {
  return isGatewayModelFree(props.model)
})

/**
 * A free model prices in at the cheapest tier, so the two badges would both
 * fire on the same row — the free badge wins and the tier is suppressed.
 */
const priceTier = computed<ModelPriceTier | null>(() => {
  return resolveGatewayPriceTier(props.model)
})

const hasPriceBadge = computed<boolean>(() => {
  return isFree.value || !!priceTier.value
})

const priceTip = computed<string | undefined>(() => {
  return formatGatewayPriceDetail(props.model.pricing)
})

const supportsImageInput = computed<boolean>(() => {
  return !!props.model.modalities?.input.includes('image')
})

/**
 * `supportsReasoning`/`supportsWebSearch` are advisory and `undefined` means
 * "this gateway does not report it", so only an explicit `true` earns a chip
 * — an unreported capability is never rendered as absent, and never as
 * present.
 */
const hasCapabilities = computed<boolean>(() => {
  return props.model.supportsReasoning === true
    || props.model.supportsWebSearch === true
    || supportsImageInput.value
})

const optionId = computed<string>(() => {
  return `gateway-model-option-${props.model.id}`
})

const detailId = computed<string>(() => {
  return `gateway-model-detail-${props.model.id}`
})
</script>
