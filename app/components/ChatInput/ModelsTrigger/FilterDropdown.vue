<template>
  <details
    ref="dropdown"
    class="dropdown dropdown-end shrink-0"
    @keydown.escape.stop="close"
  >
    <summary
      data-testid="models-picker-filter-trigger"
      class="btn btn-ghost btn-sm btn-circle relative"
      :class="{ 'text-accent': selected.length }"
      aria-label="Filter models by category"
    >
      <Icon
        name="lucide:list-filter"
        size="16"
      />
      <span
        v-if="selected.length"
        class="badge badge-xs badge-accent absolute -top-0.5 -right-0.5"
      >
        {{ selected.length }}
      </span>
    </summary>
    <ul
      data-testid="models-picker-filter-menu"
      class="dropdown-content menu menu-sm z-50 mt-1 w-52 p-1 rounded-box bg-base-100 border border-base-content/10 shadow-lg"
    >
      <li
        v-for="option in modelCategoryOptions"
        :key="option.value"
      >
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            class="checkbox checkbox-xs checkbox-accent"
            :data-testid="`models-picker-filter-${option.value}`"
            :checked="selected.includes(option.value)"
            @change="toggle(option.value)"
          >
          <Icon
            :name="option.icon"
            size="14"
            class="opacity-60"
          />
          <span class="grow">{{ option.label }}</span>
        </label>
      </li>
    </ul>
  </details>
</template>

<script setup lang="ts">
import type { ModelCategory } from '~/types/models-picker'

const selected = defineModel<ModelCategory[]>({ default: () => [] })
const dropdown = useTemplateRef<HTMLDetailsElement>('dropdown')

onClickOutside(dropdown, () => {
  close()
})

function close() {
  if (!dropdown.value?.open) {
    return
  }

  dropdown.value.open = false
}

function toggle(category: ModelCategory) {
  if (selected.value.includes(category)) {
    selected.value = selected.value.filter((value) => {
      return value !== category
    })

    return
  }

  selected.value = [...selected.value, category]
}
</script>
