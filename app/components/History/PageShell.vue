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
      class="tabs tabs-border @container"
    >
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.id"
        :to="tab.to"
        class="tab grow gap-2"
        :class="{ 'tab-active': activeTab === tab.id }"
        :aria-current="activeTab === tab.id ? 'page' : undefined"
        :aria-label="tab.label"
        :data-testid="`tab-${tab.id}`"
      >
        <Icon
          size="14"
          :name="tab.icon"
        />
        <span
          :class="{
            '@max-md:sr-only': tabs.length > BASE_TAB_COUNT
              && activeTab !== tab.id,
          }"
        >
          {{ tab.label }}
        </span>
      </NuxtLink>
    </nav>

    <slot name="toolbar" />
    <slot name="secondary-tabs" />
    <slot />
  </UiBubble>
  <div
    class="max-sm:h-[calc(var(--spacing)_*_24_+_var(--sab))] shrink-0"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
type HistoryTab
  = | 'chats'
    | 'projects'
    | 'artifacts'
    | 'documents'
    | 'shared'

interface HistoryTabLink {
  id: HistoryTab
  to: string
  label: string
  icon: string
}

const BASE_TAB_COUNT = 3

defineProps<{
  activeTab: HistoryTab
}>()

const artifactsFeature = useFeature('artifacts')
const documentsFeature = useFeature('documents')

const tabs = computed<HistoryTabLink[]>(() => {
  const tabLinks: HistoryTabLink[] = [
    {
      id: 'chats',
      to: '/chats/history',
      label: 'Chats',
      icon: 'lucide:message-circle',
    },
    {
      id: 'projects',
      to: '/chats/projects',
      label: 'Projects',
      icon: 'lucide:folder',
    },
  ]

  if (artifactsFeature.value.active) {
    tabLinks.push({
      id: 'artifacts',
      to: '/chats/artifacts',
      label: 'Artifacts',
      icon: 'lucide:app-window',
    })
  }

  if (documentsFeature.value.active) {
    tabLinks.push({
      id: 'documents',
      to: '/chats/documents',
      label: 'Documents',
      icon: 'lucide:file-text',
    })
  }

  tabLinks.push({
    id: 'shared',
    to: '/chats/shared',
    label: 'Shared',
    icon: 'lucide:share-2',
  })

  return tabLinks
})
</script>
