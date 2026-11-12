<template>
  <div class="contents sm:hidden">
    <button
      ref="triggerRef"
      type="button"
      class="btn btn-circle btn-xs btn-soft"
      :aria-label="`More actions for ${fileName}`"
      aria-haspopup="menu"
      :popovertarget="menuId"
      data-testid="files-action-more"
    >
      <Icon name="lucide:ellipsis" size="12" />
    </button>
    <div
      :id="menuId"
      ref="menuRef"
      popover="auto"
      class="js-files-actions-menu m-0 w-36 rounded-box border border-base-content/10 bg-base-100 p-0 text-base-content shadow-lg"
      data-testid="files-actions-menu"
      @beforetoggle="onBeforeToggle"
    >
      <ul
        role="menu"
        class="menu menu-sm w-full p-1"
      >
        <li>
          <button
            type="button"
            role="menuitem"
            data-testid="files-menu-rename"
            @click="onSelect('rename')"
          >
            <Icon name="lucide:pencil" size="14" />
            Rename
          </button>
        </li>
        <li>
          <button
            type="button"
            role="menuitem"
            class="text-error"
            data-testid="files-menu-delete"
            @click="onSelect('delete')"
          >
            <Icon name="lucide:trash-2" size="14" />
            Delete
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
const VIEWPORT_MARGIN_PX = 8
const MENU_OFFSET_PX = 4

defineProps<{
  fileName: string
}>()

const emit = defineEmits<{
  rename: []
  delete: []
}>()

const menuId = useId()
const triggerRef = useTemplateRef<HTMLButtonElement>('triggerRef')
const menuRef = useTemplateRef<HTMLDivElement>('menuRef')

/**
 * The menu is a top-layer popover, so neither the tile's `overflow-hidden`
 * nor the dialog's scroll container can clip it. A popover has no anchor in
 * older WebKit, so it is placed under the trigger by hand.
 */
function onBeforeToggle(event: Event) {
  const toggleEvent = event as ToggleEvent
  const trigger = triggerRef.value
  const menu = menuRef.value

  if (toggleEvent.newState !== 'open' || !trigger || !menu) {
    return
  }

  const triggerRect = trigger.getBoundingClientRect()
  const menuWidth = menu.offsetWidth || 144
  const maximumLeft = window.innerWidth - menuWidth - VIEWPORT_MARGIN_PX
  const left = Math.min(
    Math.max(triggerRect.right - menuWidth, VIEWPORT_MARGIN_PX),
    maximumLeft,
  )

  menu.style.inset = 'auto'
  menu.style.top = `${triggerRect.bottom + MENU_OFFSET_PX}px`
  menu.style.left = `${left}px`
}

function onSelect(action: 'rename' | 'delete') {
  menuRef.value?.hidePopover?.()

  if (action === 'rename') {
    emit('rename')

    return
  }

  emit('delete')
}
</script>
