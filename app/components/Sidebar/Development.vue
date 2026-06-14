<template>
  <LazySidebarSubmenu>
    <template #trigger>
      <UiButton
        ghost
        icon-name="lucide:ellipsis"
        :icon-only="true"
        title="More Features"
        circle
        tag="summary"
      />
    </template>
    <UiButton
      to="/assistants"
      ghost
      disabled
      icon-name="lucide:bot-message-square"
      :icon-only="true"
      title="Assistants (In development)"
      circle
      tooltip-position="bottom"
      tooltip-style="error"
    />
    <UiButton
      to="/workspaces"
      ghost
      disabled
      icon-name="lucide:layers-2"
      :icon-only="true"
      title="Workspaces (In development)"
      circle
      tooltip-position="bottom"
      tooltip-style="error"
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
const route = useRoute()
const ui = useCookieConsentUi()

const isChatLayout = computed<boolean>(() => route.meta.layout === 'chat')

function openCookieSettings(event: MouseEvent): void {
  const details = (event.target as HTMLElement | null)
    ?.closest('details')

  if (details) {
    details.open = false
  }

  ui.expand()
}
</script>
