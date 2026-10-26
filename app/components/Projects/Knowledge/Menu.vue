<template>
  <details
    ref="menu"
    class="dropdown dropdown-start"
    @toggle="onToggle"
    @keydown.esc="closeMenu(true)"
  >
    <summary
      class="btn btn-sm normal-case"
      :class="triggerClass"
      :aria-expanded="isOpen"
      :aria-controls="listId"
      :data-testid="triggerTestId"
    >
      <Icon
        v-if="iconName"
        :name="iconName"
        size="16"
      />
      {{ label }}
      <Icon
        name="lucide:chevron-down"
        size="14"
        class="shrink-0"
      />
    </summary>
    <ul
      :id="listId"
      class="
        dropdown-content menu menu-sm z-50 mt-2 w-64 max-w-[calc(100vw-3rem)]
        rounded-box bg-base-100 p-1 shadow-lg
      "
      :aria-label="menuLabel"
      @click="closeMenu(true)"
    >
      <slot />
    </ul>
  </details>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  menuLabel: string
  iconName?: string
  triggerTestId?: string
  triggerClass?: string
}>(), {
  iconName: undefined,
  triggerTestId: undefined,
  triggerClass: 'btn-ghost btn-ghost-legacy',
})

const listId = useId()
const menu = useTemplateRef<HTMLDetailsElement>('menu')
const isOpen = shallowRef<boolean>(false)

function onToggle() {
  isOpen.value = !!menu.value?.open
}

function closeMenu(shouldRestoreFocus: boolean = false) {
  if (!menu.value?.open) {
    return
  }

  menu.value.open = false
  isOpen.value = false

  if (shouldRestoreFocus) {
    menu.value.querySelector('summary')?.focus()
  }
}

onClickOutside(menu, () => {
  closeMenu()
})
</script>
