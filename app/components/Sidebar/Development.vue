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

const showPinToggle = computed<boolean>(() => {
  return isDesktop && reducedMotion.value !== 'reduce'
})

const isOwnedChatPage = computed<boolean>(() => {
  return route.path.startsWith('/chats/')
    && !!route.params.slug
    && route.path !== '/chats/new'
})

const isChatLayout = computed<boolean>(() => {
  return route.meta.layout === 'chat'
})

const isSharedChatPage = computed<boolean>(() => {
  return route.path.startsWith('/shared/') && !!route.params.slug
})

const canBranchSharedChat = computed<boolean>(() => {
  return isSharedChatPage.value
    && !!sharedBranchTarget.value?.allowBranch
    && sharedBranchTarget.value?.slug === route.params.slug
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
  openShareModal(route.params.slug as string)
}

function onBranch(event: MouseEvent): void {
  closeSubmenu(event)
  branchOwnedChat(route.params.slug as string)
}

function onBranchSharedChat(event: MouseEvent): void {
  closeSubmenu(event)
  branchSharedChat(route.params.slug as string)
}
</script>
