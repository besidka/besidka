<template>
  <details
    ref="dropdown"
    class="dropdown dropdown-end shrink-0"
    @keydown.escape.stop="close"
  >
    <summary
      data-testid="models-picker-filter-trigger"
      class="btn btn-ghost btn-sm btn-circle relative hitslop"
      :class="{ 'text-accent': hasActiveFilter }"
      aria-label="Filter models by category"
    >
      <Icon
        name="lucide:list-filter"
        size="16"
      />
      <span
        v-if="hasActiveFilter"
        aria-hidden="true"
        class="badge badge-xs badge-accent absolute -top-0.5 -right-0.5"
      />
    </summary>
    <ul
      data-testid="models-picker-filter-menu"
      role="listbox"
      aria-label="Filter models by category"
      class="dropdown-content menu menu-sm z-50 mt-1 w-52 p-1 rounded-box bg-base-100 border border-base-content/10 shadow-lg"
    >
      <li
        v-for="option in options"
        :key="option.value"
        role="option"
        :aria-selected="selected === option.value"
        :data-testid="`models-picker-filter-${option.value}`"
        @click="selectCategory(option.value)"
      >
        <button
          type="button"
          :aria-pressed="selected === option.value"
          :class="{ 'menu-active': selected === option.value }"
          class="flex items-center gap-2"
        >
          <Icon
            :name="option.icon"
            size="14"
            class="opacity-60"
          />
          <span class="grow">{{ option.label }}</span>
        </button>
      </li>
      <li
        role="presentation"
        data-testid="models-picker-filter-vision"
        class="mt-1 pt-1 border-t border-base-content/10"
        @click="toggleVisionOnly"
      >
        <button
          type="button"
          :aria-pressed="visionOnly"
          :class="{ 'menu-active': visionOnly }"
          class="flex items-center gap-2"
        >
          <Icon
            name="lucide:eye"
            size="14"
            class="opacity-60"
          />
          <span class="grow">Vision only</span>
          <Icon
            v-if="visionOnly"
            name="lucide:check"
            size="14"
          />
        </button>
      </li>
      <li
        role="presentation"
        data-testid="models-picker-filter-clear"
        :class="{ 'menu-disabled': !hasActiveFilter }"
      >
        <button
          type="button"
          class="flex w-full justify-start text-error disabled:opacity-50"
          :disabled="hasActiveFilter ? undefined : true"
          @click="onClear"
        >
          <Icon
            name="lucide:list-x"
            size="14"
          />
          Clear
        </button>
      </li>
    </ul>
  </details>
</template>

<script setup lang="ts">
import type {
  ModelCategory,
  ModelCategoryOption,
} from '~/types/models-picker'

withDefaults(
  defineProps<{
    options?: ModelCategoryOption[]
  }>(),
  {
    options: () => modelCategoryOptions,
  },
)

const selected = defineModel<ModelCategory | null>({ default: null })
const visionOnly = defineModel<boolean>('visionOnly', { default: false })
const dropdown = useTemplateRef<HTMLDetailsElement>('dropdown')

const hasActiveFilter = computed<boolean>(() => {
  return selected.value !== null || visionOnly.value
})

onClickOutside(dropdown, () => {
  close()
})

function close() {
  if (!dropdown.value?.open) {
    return
  }

  dropdown.value.open = false
}

function selectCategory(category: ModelCategory) {
  selected.value = selected.value === category ? null : category
  close()
}

function toggleVisionOnly() {
  visionOnly.value = !visionOnly.value
  close()
}

function onClear() {
  selected.value = null
  visionOnly.value = false
  close()
}
</script>
