<template>
  <ClientOnly>
    <template #fallback>
      <SidebarSkeleton />
    </template>
    <UiButton
      to="/chats/new"
      :disabled="$route.path === '/chats/new' ? true : null"
      mode="accent"
      icon-name="lucide:square-pen"
      :icon-only="true"
      title="Start new chat"
      circle
      tooltip-position="left"
    />
  </ClientOnly>
</template>
