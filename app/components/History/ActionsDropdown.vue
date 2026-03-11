<template>
  <div
    ref="dropdownRef"
    class="dropdown dropdown-left sm:dropdown-end"
    :class="{
      [`
        transition-opacity
        sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100
      `]:
        !isSelectionMode
    }"
  >
    <button
      v-if="!isSelectionMode"
      type="button"
      tabindex="0"
      class="btn btn-ghost btn-sm sm:btn-xs btn-circle"
      aria-label="Chat actions"
    >
      <Icon name="lucide:ellipsis-vertical" size="16" />
    </button>
    <ul
      tabindex="0"
      class="dropdown-content menu menu-sm bg-base-100 rounded-box shadow-lg z-50 w-52 p-1"
    >
      <li>
        <button
          type="button"
          @click="onSelect"
        >
          <Icon name="lucide:check-square" size="14" />
          Select
        </button>
      </li>
      <li>
        <button
          type="button"
          @click="onPin"
        >
          <Icon
            :name="chat.pinnedAt ? 'lucide:pin-off' : 'lucide:pin'"
            size="14"
          />
          {{ chat.pinnedAt ? 'Unpin' : 'Pin' }}
        </button>
      </li>
      <li>
        <button
          type="button"
          @click="onAddToFolder"
        >
          <Icon name="lucide:folder" size="14" />
          {{ chat.folderId ? 'Change folder' : 'Add to folder' }}
        </button>
      </li>
      <li v-if="chat.folderId">
        <button
          type="button"
          @click="onRemoveFromFolder"
        >
          <Icon name="lucide:folder-minus" size="14" />
          Remove from folder
        </button>
      </li>
      <li>
        <button
          type="button"
          @click="onRename"
        >
          <Icon name="lucide:pencil" size="14" />
          Rename
        </button>
      </li>
      <li>
        <button
          type="button"
          class="text-error"
          @click="onDelete"
        >
          <Icon name="lucide:trash-2" size="14" />
          Delete
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { HistoryChat } from '#shared/types/history.d'

defineProps<{
  chat: HistoryChat
  isSelectionMode: boolean
}>()

const emit = defineEmits<{
  pin: []
  rename: []
  delete: []
  select: []
  addToFolder: []
  removeFromFolder: []
}>()

const dropdownRef = shallowRef<HTMLElement | null>(null)

function closeDropdown() {
  if (dropdownRef.value) {
    const activeEl = document.activeElement as HTMLElement | null
    activeEl?.blur()
  }
}

function onSelect() {
  closeDropdown()
  emit('select')
}

function onPin() {
  closeDropdown()
  emit('pin')
}

function onAddToFolder() {
  closeDropdown()
  emit('addToFolder')
}

function onRemoveFromFolder() {
  closeDropdown()
  emit('removeFromFolder')
}

function onRename() {
  closeDropdown()
  emit('rename')
}

function onDelete() {
  closeDropdown()
  emit('delete')
}
</script>
