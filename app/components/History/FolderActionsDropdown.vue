<template>
  <div
    ref="dropdownRef"
    class="dropdown dropdown-bottom dropdown-end relative z-20"
    @click.stop
    @keydown.stop
    @mousedown.stop
  >
    <slot>
      <button
        type="button"
        class="btn btn-ghost btn-sm sm:btn-xs btn-circle"
        aria-label="Folder actions"
      >
        <Icon name="lucide:ellipsis-vertical" size="16" />
      </button>
    </slot>
    <div class="dropdown-content pt-2">
      <ul
        tabindex="0"
        class="menu menu-sm bg-base-100 rounded-box shadow-lg z-50 w-52 p-1"
      >
        <li>
          <button
            type="button"
            @click="onPin"
          >
            <Icon
              :name="folder.pinnedAt ? 'lucide:pin-off' : 'lucide:pin'"
              size="14"
            />
            {{ folder.pinnedAt ? 'Unpin' : 'Pin' }}
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
            @click="onArchive"
          >
            <Icon
              :name="folder.archivedAt
                ? 'lucide:archive-restore'
                : 'lucide:archive'"
              size="14"
            />
            {{ folder.archivedAt ? 'Restore' : 'Archive' }}
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
  </div>
</template>

<script setup lang="ts">
import type { Folder } from '#shared/types/folders.d'

defineProps<{
  folder: Folder
}>()

const emit = defineEmits<{
  pin: []
  rename: []
  archive: []
  delete: []
}>()

const dropdownRef = shallowRef<HTMLElement | null>(null)

function closeDropdown() {
  if (dropdownRef.value) {
    const activeEl = document.activeElement as HTMLElement | null
    activeEl?.blur()
  }
}

function onPin() {
  closeDropdown()
  emit('pin')
}

function onRename() {
  closeDropdown()
  emit('rename')
}

function onArchive() {
  closeDropdown()
  emit('archive')
}

function onDelete() {
  closeDropdown()
  emit('delete')
}
</script>
