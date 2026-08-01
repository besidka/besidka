<template>
  <li
    :id="optionId"
    role="option"
    :aria-selected="isLegacy ? false : isSelected"
    :aria-disabled="isLegacy ? true : undefined"
  >
    <div
      class="flex items-center gap-1 rounded-xl pl-2 pr-1 py-1 transition-colors"
      :class="{
        'bg-accent/15': isSelected && !isLegacy,
        'bg-base-content/10': isHighlighted && !isSelected && !isLegacy,
        'hover:bg-base-content/5': !isSelected && !isHighlighted && !isLegacy
      }"
    >
      <component
        :is="isLegacy ? 'div' : 'button'"
        :type="isLegacy ? undefined : 'button'"
        :aria-label="isLegacy ? undefined : selectLabel"
        class="grow min-w-0 flex flex-wrap xs:flex-nowrap items-center gap-x-2 gap-y-1 py-1 text-left"
        :class="isLegacy ? 'opacity-50' : 'cursor-pointer'"
        @click="onSelect"
      >
        <span
          v-if="isLegacy"
          class="sr-only"
        >
          Deprecated, no longer selectable.
        </span>
        <span
          class="w-full xs:w-auto min-w-0 flex items-center gap-1.5"
        >
          <SvgoGeminiShort
            v-if="providerId === 'google'"
            class="w-3.5 shrink-0 fill-base-content/40"
          />
          <SvgoOpenai
            v-else-if="providerId === 'openai'"
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
          v-if="model.priceTier"
          data-testid="model-price-tier"
          class="badge badge-xs badge-soft shrink-0 font-semibold tooltip tooltip-soft tooltip-bottom max-xs:ml-5"
          :class="getPriceTierClass(model.priceTier)"
          :data-tip="priceTip"
        >
          {{ model.priceTier }}
          <span
            v-if="priceTip"
            class="sr-only"
          >
            {{ priceTip }}
          </span>
        </span>
        <span
          v-if="hasCapabilities"
          data-testid="model-capabilities"
          class="shrink-0 flex gap-1 items-center xs:ml-auto"
          :class="{
            'max-xs:ml-5': !model.priceTier,
            'max-xs:-ml-1': !!model.priceTier
          }"
        >
          <span
            v-if="model.reasoning"
            class="capability-chip shrink-0 flex items-center p-0.5 rounded-full text-warning"
            :class="{ 'tooltip tooltip-soft tooltip-bottom': hasTooltip }"
            data-tip="Reasoning"
          >
            <Icon name="lucide:brain" />
          </span>
          <span
            v-if="model.tools.includes('web_search')"
            class="capability-chip shrink-0 flex items-center p-0.5 rounded-full text-info"
            :class="{ 'tooltip tooltip-soft tooltip-bottom': hasTooltip }"
            data-tip="Web search"
          >
            <Icon name="lucide:globe" />
          </span>
          <span
            v-if="hasImageGenerationCapability(model)"
            data-testid="model-image-generation-capability"
            class="capability-chip shrink-0 flex items-center p-0.5 rounded-full text-violet-700 dark:text-violet-200"
            :class="{ 'tooltip tooltip-soft tooltip-bottom': hasTooltip }"
            data-tip="Image generation"
          >
            <Icon name="lucide:image-plus" />
          </span>
          <span
            v-if="model.research"
            class="capability-chip shrink-0 flex items-center p-0.5 rounded-full text-success"
            :class="{ 'tooltip tooltip-soft tooltip-bottom': hasTooltip }"
            data-tip="Deep research"
          >
            <Icon name="lucide:telescope" />
          </span>
        </span>
      </component>
      <span
        data-testid="model-actions"
        class="shrink-0 flex items-center gap-1 max-xs:flex-col"
      >
        <button
          type="button"
          data-testid="model-info-trigger"
          class="btn btn-ghost btn-xs btn-circle shrink-0 max-xs:[--size:calc(var(--size-field)_*_7)] hitslop"
          :class="{ 'text-accent': isDetailOpen, 'btn-active': isDetailOpen }"
          :aria-label="`About ${model.name}`"
          :aria-expanded="isDetailOpen"
          :aria-controls="isDetailOpen ? detailId : undefined"
          :aria-describedby="isDetailOpen ? detailId : undefined"
          @click.stop="onInfoClick"
        >
          <Icon
            name="lucide:info"
            size="14"
          />
        </button>
        <button
          v-if="!isLegacy"
          type="button"
          data-testid="model-favorite-toggle"
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
import type { Model } from '#shared/types/providers.d'

const props = defineProps<{
  model: Model
  providerId: string
  isSelected: boolean
  isHighlighted: boolean
  isFavorite: boolean
  isDetailOpen: boolean
  isLegacy?: boolean
}>()

const emit = defineEmits<{
  select: []
  toggleFavorite: []
  toggleDetail: []
}>()

const { isDesktop } = useDevice()

const priceTip = computed<string | undefined>(() => {
  return getModelPriceTip(props.model)
})

const hasTooltip = computed<boolean>(() => {
  return isDesktop && !props.isLegacy
})

const hasCapabilities = computed<boolean>(() => {
  const { model } = props

  return !!model.reasoning
    || model.tools.includes('web_search')
    || hasImageGenerationCapability(model)
    || !!model.research
})

const selectLabel = computed<string>(() => {
  return `Choose ${props.model.name}`
})

const optionId = computed<string>(() => {
  return `model-option-${props.model.id}`
})

const detailId = computed<string>(() => {
  return `model-detail-${props.model.id}`
})

function onSelect() {
  if (props.isLegacy) {
    return
  }

  emit('select')
}

function onInfoClick() {
  emit('toggleDetail')
}
</script>
