<template>
  <div
    data-testid="models-picker-filter-section"
    class="shrink-0 flex flex-wrap items-center gap-x-1.5 gap-y-2.5 px-2 py-2.5 border-b border-base-content/10"
  >
    <div
      role="group"
      aria-label="Filter models by category"
      class="contents"
    >
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        :data-testid="`models-picker-filter-${option.value}`"
        :class="getChipClass(selected === option.value)"
        :aria-pressed="selected === option.value"
        @click="selectCategory(option.value)"
      >
        <Icon
          :name="option.icon"
          size="12"
          class="shrink-0 opacity-70"
        />
        {{ option.label }}
      </button>
    </div>
    <div
      role="group"
      aria-label="Filter models by capability"
      class="contents"
    >
      <button
        type="button"
        data-testid="models-picker-filter-vision"
        :class="getChipClass(visionOnly)"
        :aria-pressed="visionOnly"
        @click="visionOnly = !visionOnly"
      >
        <Icon
          name="lucide:eye"
          size="12"
          class="shrink-0 opacity-70"
        />
        Vision only
      </button>
      <button
        v-for="option in capabilityOptions"
        :key="option.value"
        type="button"
        :data-testid="`models-picker-filter-${option.value}`"
        :class="getChipClass(capabilities.includes(option.value))"
        :aria-pressed="capabilities.includes(option.value)"
        @click="toggleCapability(option.value)"
      >
        <Icon
          :name="option.icon"
          size="12"
          class="shrink-0 opacity-70"
        />
        {{ option.label }}
      </button>
    </div>
    <button
      type="button"
      data-testid="models-picker-filter-clear"
      class="btn btn-ghost btn-xs shrink-0 gap-1 rounded-full px-2.5 text-xs text-error hitslop before:h-11"
      :disabled="hasActiveFilter ? undefined : true"
      @click="clear"
    >
      <Icon
        name="lucide:list-x"
        size="12"
        class="shrink-0"
      />
      Clear
    </button>
  </div>
</template>

<script setup lang="ts">
import type {
  GatewayCapabilityFilter,
  GatewayCapabilityFilterOption,
  ModelCategory,
  ModelCategoryOption,
} from '~/types/models-picker'

withDefaults(
  defineProps<{
    options?: ModelCategoryOption[]
    capabilityOptions?: GatewayCapabilityFilterOption[]
  }>(),
  {
    options: () => modelCategoryOptions,
    capabilityOptions: () => [],
  },
)

const selected = defineModel<ModelCategory | null>({ default: null })
const visionOnly = defineModel<boolean>('visionOnly', { default: false })
const capabilities = defineModel<GatewayCapabilityFilter[]>('capabilities', {
  default: () => [],
})

const hasActiveFilter = computed<boolean>(() => {
  return selected.value !== null
    || visionOnly.value
    || capabilities.value.length > 0
})

function getChipClass(isActive: boolean): string[] {
  return [
    'btn btn-xs shrink-0 gap-1 rounded-full px-2.5 text-xs font-medium hitslop before:h-11',
    isActive
      ? 'btn-soft btn-accent'
      : 'btn-ghost bg-base-content/5',
  ]
}

function selectCategory(category: ModelCategory) {
  selected.value = selected.value === category ? null : category
}

function toggleCapability(value: GatewayCapabilityFilter) {
  capabilities.value = capabilities.value.includes(value)
    ? capabilities.value.filter((filter) => {
      return filter !== value
    })
    : [...capabilities.value, value]
}

function clear() {
  selected.value = null
  visionOnly.value = false
  capabilities.value = []
}
</script>
