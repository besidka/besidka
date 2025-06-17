<template>
  <UiButton
    to="/chats/history"
    ghost
    disabled
    icon-name="lucide:history"
    :icon-only="true"
    title="History (In development)"
    circle
    tooltip-position="left"
    tooltip-style="error"
  />
  <LazySidebarSubmenu>
    <template #trigger>
      <UiButton
        ghost
        icon-name="lucide:ellipsis"
        :icon-only="true"
        title="More Features"
        circle
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
  </LazySidebarSubmenu>
</template>
