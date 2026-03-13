<template>
  <div class="mb-6">
    <h1 class="text-4xl font-bold text-center">
      <slot name="title" />
    </h1>
    <div
      v-if="!!$slots.subtitle"
      class="mt-2 text-center"
    >
      <slot name="subtitle" />
    </div>
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
        to="/chats/projects"
        class="tab grow"
        :class="{ 'tab-active': activeTab === 'projects' }"
        :aria-current="activeTab === 'projects' ? 'page' : undefined"
      >
        <Icon
          name="lucide:folder"
          size="14"
          class="mr-2"
        />
        Projects
      </NuxtLink>
    </nav>

    <slot name="toolbar" />
    <slot name="secondary-tabs" />
    <slot />
  </UiBubble>
</template>

<script setup lang="ts">
defineProps<{
  activeTab: 'chats' | 'projects'
}>()
</script>
