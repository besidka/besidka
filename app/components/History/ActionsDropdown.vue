<template>
  <div
    v-if="isSelectionMode"
    class="shrink-0 w-8 sm:w-6"
    aria-hidden="true"
  />
  <details
    v-else
    ref="dropdownRef"
    class="
      dropdown dropdown-bottom dropdown-end relative z-20 open:z-40
      transition-opacity
      sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100
    "
  >
    <summary
      data-testid="history-chat-actions-trigger"
      class="btn btn-ghost btn-sm sm:btn-xs btn-circle"
      aria-label="Chat actions"
    >
      <Icon name="lucide:ellipsis-vertical" size="16" />
    </summary>
    <div class="dropdown-content z-50 w-52 pt-2">
      <ul
        tabindex="0"
        class="menu menu-sm bg-base-100 rounded-box shadow-lg w-52 p-1"
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
        <li v-if="variant !== 'shared'">
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
        <li v-if="variant !== 'shared'">
          <button
            type="button"
            @click="onAddToProject"
          >
            <Icon name="lucide:folder" size="14" />
            {{ chat.projectId ? 'Change project' : 'Add to project' }}
          </button>
        </li>
        <li v-if="variant !== 'shared' && chat.projectId">
          <button
            type="button"
            @click="onRemoveFromProject"
          >
            <Icon name="lucide:minus" size="14" />
            Remove from project
          </button>
        </li>
        <li v-if="variant !== 'shared'">
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
            data-testid="chat-action-share"
            @click="onShare"
          >
            <Icon name="lucide:share-2" size="14" />
            Share
          </button>
        </li>
        <li>
          <button
            type="button"
            data-testid="chat-action-fork"
            @click="onFork"
          >
            <Icon name="lucide:git-branch-plus" size="14" />
            Fork
          </button>
        </li>
        <li v-if="chat.shared">
          <button
            type="button"
            class="text-warning"
            data-testid="chat-action-cancel-sharing"
            @click="onCancelSharing"
          >
            <Icon name="lucide:link-2-off" size="14" />
            Cancel sharing
          </button>
        </li>
        <li v-if="variant !== 'shared'">
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
import type { HistoryChat } from '#shared/types/history.d'

const props = withDefaults(
  defineProps<{
    chat: HistoryChat
    isSelectionMode: boolean
    variant?: 'default' | 'shared'
  }>(),
  {
    variant: 'default',
  },
)

const emit = defineEmits<{
  pin: []
  rename: []
  delete: []
  select: []
  addToProject: []
  removeFromProject: []
  cancelSharing: []
}>()

const dropdownRef = useTemplateRef<HTMLDetailsElement>('dropdownRef')

onClickOutside(dropdownRef, () => {
  if (dropdownRef.value?.open) {
    closeDropdown()
  }
})

function closeDropdown() {
  if (dropdownRef.value) {
    dropdownRef.value.open = false
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

function onAddToProject() {
  closeDropdown()
  emit('addToProject')
}

function onRemoveFromProject() {
  closeDropdown()
  emit('removeFromProject')
}

function onRename() {
  closeDropdown()
  emit('rename')
}

function onShare() {
  closeDropdown()
  useChatShare().openShareModal(props.chat.slug)
}

function onFork() {
  closeDropdown()
  useChatShare().forkOwnedChat(props.chat.slug)
}

function onCancelSharing() {
  closeDropdown()
  emit('cancelSharing')
}

function onDelete() {
  closeDropdown()
  emit('delete')
}
</script>
