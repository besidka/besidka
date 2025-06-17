<template>
  <ClientOnly>
    <template #fallback>
      <SidebarSkeleton />
    </template>

    <div class="max-sm:px-3">
      <UiButton
        to="/chats/new"
        :disabled="$route.path === '/chats/new' ? true : null"
        mode="accent"
        icon-name="lucide:square-pen"
        :icon-only="true"
        title="Start new chat"
        circle
        tooltip-position="left"
        :class="{
          'max-sm:scale-120 max-sm:-translate-y-3':
            $route.path !== '/chats/new',
        }"
      />
    </div>
  </ClientOnly>
</template>
