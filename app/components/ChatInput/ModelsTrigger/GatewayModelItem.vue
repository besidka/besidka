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
          <span
            class="truncate text-sm font-medium"
            :class="{ 'text-accent': isSelected }"
          >
            {{ model.name }}
          </span>
        </span>
        <span
          v-if="priceLabel"
          data-testid="gateway-model-price"
          class="shrink-0 text-[0.65rem] font-medium tabular-nums opacity-60"
        >
          {{ priceLabel }}
        </span>
        <span
          v-if="hasCapabilities"
          data-testid="gateway-model-capabilities"
          class="shrink-0 flex gap-1 items-center xs:ml-auto"
        >
          <span
            v-if="model.supportsTools"
            class="capability-chip shrink-0 flex items-center p-0.5 rounded-full text-info"
            :class="{ 'tooltip tooltip-soft tooltip-bottom': isDesktop }"
            data-tip="Tool calling"
          >
            <Icon name="lucide:wrench" />
          </span>
          <span
            v-if="supportsImageInput"
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

const priceLabel = computed<string | undefined>(() => {
  return formatGatewayPrice(props.model.pricing)
})

const supportsImageInput = computed<boolean>(() => {
  return !!props.model.modalities?.input.includes('image')
})

const hasCapabilities = computed<boolean>(() => {
  return !!props.model.supportsTools || supportsImageInput.value
})

const optionId = computed<string>(() => {
  return `gateway-model-option-${props.model.id}`
})

const detailId = computed<string>(() => {
  return `gateway-model-detail-${props.model.id}`
})
</script>
