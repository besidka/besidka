<template>
  <details
    ref="dropdownRef"
    class="dropdown dropdown-bottom dropdown-start relative z-20 open:z-40"
  >
    <summary
      data-testid="chat-actions-trigger"
      class="js-chat-actions btn btn-ghost btn-sm btn-circle"
      aria-label="Chat actions"
    >
      <Icon name="lucide:ellipsis-vertical" size="16" />
    </summary>
    <div class="dropdown-content z-50 w-44 pt-2">
      <ul
        tabindex="0"
        class="menu menu-sm bg-base-100 rounded-box shadow-lg w-44 p-1"
      >
        <li>
          <button
            type="button"
            data-testid="chat-actions-share"
            @click="onShare"
          >
            <Icon name="lucide:share-2" size="14" />
            Share
          </button>
        </li>
        <li>
          <button
            type="button"
            data-testid="chat-actions-fork"
            :disabled="isForking"
            @click="onFork"
          >
            <Icon name="lucide:git-branch-plus" size="14" />
            Fork
          </button>
        </li>
      </ul>
    </div>
  </details>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  chatSlug: string
  hasFiles?: boolean
}>(), {
  hasFiles: false,
})

const { isForking, openShareModal, forkOwnedChat } = useChatShare()

const dropdownRef = useTemplateRef<HTMLDetailsElement>('dropdownRef')

onClickOutside(dropdownRef, () => {
  if (dropdownRef.value?.open) {
    closeDropdown()
  }
})

function closeDropdown() {
  if (!dropdownRef.value) {
    return
  }

  dropdownRef.value.open = false

  const activeElement = document.activeElement as HTMLElement | null

  activeElement?.blur()
}

function onShare() {
  closeDropdown()
  openShareModal(props.chatSlug, props.hasFiles)
}

function onFork() {
  closeDropdown()
  forkOwnedChat(props.chatSlug)
}
</script>
