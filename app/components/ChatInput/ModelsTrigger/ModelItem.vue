<template>
  <li
    :id="optionId"
    role="option"
    :aria-selected="isSelected"
  >
    <div
      class="flex items-center gap-0.5 rounded-xl pl-2 pr-1 py-1 transition-colors"
      :class="{
        'bg-accent/15': isSelected,
        'bg-base-content/10': isHighlighted && !isSelected,
        'hover:bg-base-content/5': !isSelected && !isHighlighted
      }"
    >
      <button
        type="button"
        class="grow min-w-0 flex flex-col items-start gap-0.5 py-1 text-left cursor-pointer"
        :aria-label="`Choose ${model.name}`"
        @click="emit('select')"
      >
        <span class="w-full min-w-0 flex items-center gap-1.5">
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
          <span
            v-if="model.priceTier"
            data-testid="model-price-tier"
            class="badge badge-xs shrink-0 font-semibold"
            :class="getPriceTierClass(model.priceTier)"
            :title="priceTip"
          >
            {{ model.priceTier }}
            <span
              v-if="priceTip"
              class="sr-only"
            >
              {{ priceTip }}
            </span>
          </span>
          <span class="grow" />
          <span class="shrink-0 flex gap-1 items-center">
            <span
              v-if="model.reasoning"
              class="shrink-0 flex items-center p-0.5 rounded-full bg-warning-content"
              :class="{
                'tooltip tooltip-warning tooltip-top': $device.isDesktop
              }"
              data-tip="Reasoning"
            >
              <Icon
                name="lucide:brain"
                class="text-warning"
              />
            </span>
            <span
              v-if="model.tools.includes('web_search')"
              class="shrink-0 flex items-center p-0.5 rounded-full bg-info-content"
              :class="{
                'tooltip tooltip-info tooltip-top': $device.isDesktop
              }"
              data-tip="Web search"
            >
              <Icon
                name="lucide:globe"
                class="text-info"
              />
            </span>
            <span
              v-if="hasImageGenerationCapability(model)"
              data-testid="model-image-generation-capability"
              class="shrink-0 flex items-center p-0.5 rounded-full bg-green-100 dark:bg-secondary-content"
              :class="{
                'tooltip tooltip-secondary tooltip-top': $device.isDesktop
              }"
              data-tip="Image generation"
            >
              <Icon
                name="lucide:image-plus"
                class="text-green-800 dark:text-secondary"
              />
            </span>
            <span
              v-if="model.research"
              class="shrink-0 flex items-center p-0.5 rounded-full bg-[color-mix(in_oklab,var(--color-success)_15%,var(--color-base-100))] text-success"
              :class="{
                'tooltip tooltip-success tooltip-top': $device.isDesktop
              }"
              data-tip="Deep research"
            >
              <Icon
                name="lucide:telescope"
                class="text-success"
              />
            </span>
          </span>
        </span>
        <span
          v-if="model.description"
          class="w-full truncate text-xs opacity-60"
        >
          {{ model.description }}
        </span>
      </button>
      <button
        type="button"
        data-testid="model-favorite-toggle"
        class="btn btn-ghost btn-xs btn-circle shrink-0"
        :class="{ 'text-warning': isFavorite }"
        :aria-label="isFavorite
          ? `Remove ${model.name} from favorites`
          : `Add ${model.name} to favorites`
        "
        :aria-pressed="isFavorite"
        @click.stop="emit('toggleFavorite')"
      >
        <Icon
          name="lucide:star"
          mode="svg"
          size="14"
          :class="{ '[&_path]:fill-current': isFavorite }"
        />
      </button>
      <button
        type="button"
        data-testid="model-info-trigger"
        class="btn btn-ghost btn-xs btn-circle shrink-0"
        :class="{ 'text-accent': isDetailOpen }"
        :aria-label="`About ${model.name}`"
        :aria-expanded="isDetailOpen"
        :aria-controls="isDetailOpen ? detailId : undefined"
        :aria-describedby="isDetailOpen ? detailId : undefined"
        @click.stop="onInfoClick"
        @mouseenter="revealDetail"
        @mouseleave="dismissDetail"
        @focus="revealDetail"
        @blur="dismissDetail"
      >
        <Icon
          name="lucide:info"
          size="14"
        />
      </button>
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
}>()

const emit = defineEmits<{
  select: []
  toggleFavorite: []
  showDetail: []
  hideDetail: []
  toggleDetail: []
}>()

const { isDesktop } = useDevice()

const priceTip = computed<string | undefined>(() => {
  return getModelPriceTip(props.model)
})

const optionId = computed<string>(() => {
  return `model-option-${props.model.id}`
})

const detailId = computed<string>(() => {
  return `model-detail-${props.model.id}`
})

/**
 * Pointer and keyboard both open the detail on desktop only. A touch tap
 * fires `focus` before `click`, so an ungated focus handler would open the
 * detail and let the following `toggleDetail` immediately close it again.
 */
function revealDetail() {
  if (!isDesktop) {
    return
  }

  emit('showDetail')
}

function dismissDetail() {
  if (!isDesktop) {
    return
  }

  emit('hideDetail')
}

function onInfoClick() {
  if (isDesktop) {
    return
  }

  emit('toggleDetail')
}
</script>
