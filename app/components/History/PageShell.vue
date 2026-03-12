<template>
  <div class="mb-6">
    <slot name="title">
      <h1 class="text-4xl font-bold text-center">
        History
      </h1>
    </slot>
    <slot name="subtitle">
      <h2 class="mt-2 text-center">
        View your chat history and revisit past conversations
      </h2>
    </slot>
  </div>

  <UiBubble class="flex flex-col gap-4">
    <nav
      aria-label="History sections"
      class="tabs tabs-border"
    >
      <NuxtLink
        to="/chats/history"
        class="tab grow"
        :class="{ 'tab-active': activeTab === 'chats' }"
        :aria-current="activeTab === 'chats' ? 'page' : undefined"
      >
        <Icon
          size="14"
          name="lucide:message-circle"
          class="mr-2"
        />
        Chats
      </NuxtLink>
      <NuxtLink
        to="/chats/folders"
        class="tab grow"
        :class="{ 'tab-active': activeTab === 'folders' }"
        :aria-current="activeTab === 'folders' ? 'page' : undefined"
      >
        <Icon
          name="lucide:folders"
          size="14"
          class="mr-2"
        />
        Folders
      </NuxtLink>
    </nav>

    <slot name="toolbar" />
    <slot name="secondary-tabs" />
    <slot />
  </UiBubble>
</template>

<script setup lang="ts">
defineProps<{
  activeTab: 'chats' | 'folders'
}>()
</script>
