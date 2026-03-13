<template>
  <details
    ref="dropdownRef"
    class="js-project-actions-dropdown dropdown dropdown-left sm:dropdown-end relative z-20"
  >
    <slot>
      <summary
        data-testid="history-project-actions-trigger"
        class="btn btn-ghost btn-sm sm:btn-xs btn-circle"
        aria-label="Project actions"
      >
        <Icon name="lucide:ellipsis-vertical" size="16" />
      </summary>
    </slot>
    <div class="dropdown-content z-50 w-52 pt-2">
      <ul
        tabindex="0"
        class="menu menu-sm bg-base-100 rounded-box shadow-lg w-52 p-1"
      >
        <li>
          <button
            type="button"
            @click="onPin"
          >
            <Icon
              :name="project.pinnedAt ? 'lucide:pin-off' : 'lucide:pin'"
              size="14"
            />
            {{ project.pinnedAt ? 'Unpin' : 'Pin' }}
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
              :name="project.archivedAt
                ? 'lucide:archive-restore'
                : 'lucide:archive'"
              size="14"
            />
            {{ project.archivedAt ? 'Restore' : 'Archive' }}
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
  </details>
</template>

<script setup lang="ts">
import type { Project } from '#shared/types/projects.d'

defineProps<{
  project: Project
}>()

const emit = defineEmits<{
  pin: []
  rename: []
  archive: []
  delete: []
}>()

const dropdownRef = useTemplateRef<HTMLDetailsElement>('dropdownRef')

function closeDropdown() {
  if (dropdownRef.value) {
    dropdownRef.value.open = false
    const activeEl = document.activeElement as HTMLElement | null

    activeEl?.blur()
  }
}

onClickOutside(dropdownRef, () => {
  if (dropdownRef.value?.open) {
    closeDropdown()
  }
})

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
