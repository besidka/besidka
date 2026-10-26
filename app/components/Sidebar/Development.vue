<template>
  <LazySidebarSubmenu>
    <template #trigger>
      <UiButton
        ghost
        icon-name="lucide:ellipsis"
        :icon-only="true"
        title="More Features"
        :tooltip="null"
        circle
        tag="summary"
        data-testid="sidebar-more-features"
      />
    </template>
    <UiButton
      v-if="showPinToggle"
      ghost
      circle
      :icon-only="true"
      :icon-name="sidebarPinned ? 'lucide:pin-off' : 'lucide:pin'"
      :title="sidebarPinned ? 'Unpin sidebar' : 'Pin sidebar'"
      tooltip-position="bottom"
      @click="setSidebarPinned(!sidebarPinned)"
    />
    <UiButton
      v-if="isChatLayout"
      ghost
      icon-name="lucide:cookie"
      :icon-only="true"
      title="Cookie settings"
      circle
      tooltip-position="bottom"
      data-testid="cookies-trigger-menu"
      @click="openCookieSettings"
    />
    <UiButton
      v-if="isOwnedChatPage"
      ghost
      icon-name="lucide:git-branch-plus"
      :icon-only="true"
      title="Branch"
      circle
      tooltip-position="bottom"
      data-testid="sidebar-branch"
      @click="onBranch"
    />
    <UiButton
      v-if="isOwnedChatPage"
      ghost
      icon-name="lucide:share-2"
      :icon-only="true"
      title="Share"
      circle
      tooltip-position="bottom"
      data-testid="sidebar-share"
      @click="onShare"
    />
    <UiButton
      v-if="isOwnedChatPage"
      ghost
      :icon-name="isRouteChatMemoryExcluded
        ? 'lucide:eye'
        : CHAT_MEMORY_EXCLUSION_ICON"
      :icon-only="true"
      :title="isRouteChatMemoryExcluded
        ? 'Use this chat for memory'
        : CHAT_MEMORY_EXCLUSION_LABEL"
      :disabled="memoryExclusionSavingSlug === routeSlug"
      circle
      tooltip-position="bottom"
      data-testid="sidebar-memory-exclusion"
      @click="onToggleMemoryExclusion"
    />
    <UiButton
      v-if="canBranchSharedChat"
      ghost
      icon-name="lucide:git-branch-plus"
      :icon-only="true"
      title="Branch"
      circle
      tooltip-position="bottom"
      data-testid="sidebar-branch-shared"
      @click="onBranchSharedChat"
    />
  </LazySidebarSubmenu>
</template>

<script setup lang="ts">
const route = useRoute()
const layout = useLayout()
const ui = useCookieConsentUi()
const { isDesktop } = useDevice()
const reducedMotion = usePreferredReducedMotion()
const { sidebarPinned, setSidebarPinned } = useUserSetting()
const {
  openShareModal,
  branchOwnedChat,
  branchSharedChat,
  sharedBranchTarget,
} = useChatShare()
const {
  savingSlug: memoryExclusionSavingSlug,
  isChatMemoryExcluded,
  setChatMemoryExcluded,
} = useChatMemoryExclusion()

const showPinToggle = computed<boolean>(() => {
  return isDesktop && reducedMotion.value !== 'reduce'
})

const routeSlug = computed<string>(() => {
  return 'slug' in route.params ? String(route.params.slug) : ''
})

const isOwnedChatPage = computed<boolean>(() => {
  return route.path.startsWith('/chats/')
    && !!routeSlug.value
    && route.path !== '/chats/new'
})

const isRouteChatMemoryExcluded = computed<boolean>(() => {
  return isChatMemoryExcluded(routeSlug.value)
})

const isChatLayout = computed<boolean>(() => {
  return layout.value === 'chat'
})

const isSharedChatPage = computed<boolean>(() => {
  return route.path.startsWith('/shared/') && !!routeSlug.value
})

const canBranchSharedChat = computed<boolean>(() => {
  return isSharedChatPage.value
    && !!sharedBranchTarget.value?.allowBranch
    && sharedBranchTarget.value?.slug === routeSlug.value
})

function closeSubmenu(event: MouseEvent): void {
  const details = (event.target as HTMLElement | null)
    ?.closest('details')

  if (details) {
    details.open = false
  }
}

function openCookieSettings(event: MouseEvent): void {
  closeSubmenu(event)
  ui.expand()
}

function onShare(event: MouseEvent): void {
  closeSubmenu(event)
  openShareModal(routeSlug.value)
}

async function onToggleMemoryExclusion(event: MouseEvent): Promise<void> {
  closeSubmenu(event)
  await setChatMemoryExcluded(routeSlug.value, !isRouteChatMemoryExcluded.value)
}

function onBranch(event: MouseEvent): void {
  closeSubmenu(event)
  branchOwnedChat(routeSlug.value)
}

function onBranchSharedChat(event: MouseEvent): void {
  closeSubmenu(event)
  branchSharedChat(routeSlug.value)
}
</script>
