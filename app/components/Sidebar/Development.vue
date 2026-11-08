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
  </LazySidebarSubmenu>
</template>

<script setup lang="ts">
const layout = useLayout()
const ui = useCookieConsentUi()
const { sidebarPinned, setSidebarPinned } = useUserSetting()
const { showPinToggle } = useSidebarPinToggle()

const isChatLayout = computed<boolean>(() => {
  return layout.value === 'chat'
})

function openCookieSettings(event: MouseEvent): void {
  const details = (event.target as HTMLElement | null)?.closest('details')

  if (details) {
    details.open = false
  }

  ui.expand()
}
</script>
