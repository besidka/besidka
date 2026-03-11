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
    <div
      role="tablist"
      class="tabs tabs-box tabs-sm"
    >
      <NuxtLink
        to="/chats/history"
        role="tab"
        class="tab w-1/2"
        :class="{ 'tab-active': activeTab === 'chats' }"
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
        role="tab"
        class="tab w-1/2"
        :class="{ 'tab-active': activeTab === 'folders' }"
      >
       <Icon
          name="lucide:folders"
          size="14"
          class="mr-2"
        />
        Folders
      </NuxtLink>
    </div>

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
