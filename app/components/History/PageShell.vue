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
          :class="tabs.length > BASE_TAB_COUNT && activeTab !== tab.id
            ? collapseClass
            : ''"
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
    | 'skills'
    | 'connectors'
    | 'shared'

interface HistoryTabLink {
  id: HistoryTab
  to: string
  label: string
  icon: string
}

const BASE_TAB_COUNT = 3
const FIVE_TAB_COUNT = 5
const SIX_TAB_COUNT = 6
const SEVEN_TAB_COUNT = 7

defineProps<{
  activeTab: HistoryTab
}>()

const artifactsFeature = useFeature('artifacts')
const documentsFeature = useFeature('documents')
const skillsFeature = useFeature('skills')
const connectorsFeature = useFeature('connectors')

/**
 * Inactive tabs keep only their icon when the row cannot hold every label.
 * Six labeled tabs need about 570px (measured with Nunito: 82, 96, 100, 118,
 * 80 and 91px), five need about 480px, seven (with Connectors, about 105px)
 * need about 680px, so the container width that triggers the collapse grows
 * with the tab count. The class strings are written out in
 * full so Tailwind can see them.
 */
const collapseClass = computed<string>(() => {
  if (tabs.value.length >= SEVEN_TAB_COUNT) {
    return '@max-[44rem]:sr-only'
  }

  if (tabs.value.length >= SIX_TAB_COUNT) {
    return '@max-[40rem]:sr-only'
  }

  return tabs.value.length === FIVE_TAB_COUNT
    ? '@max-[34rem]:sr-only'
    : '@max-md:sr-only'
})

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

  if (skillsFeature.value.active) {
    tabLinks.push({
      id: 'skills',
      to: '/chats/skills',
      label: 'Skills',
      icon: 'lucide:sparkles',
    })
  }

  if (connectorsFeature.value.active) {
    tabLinks.push({
      id: 'connectors',
      to: '/chats/connectors',
      label: 'Connectors',
      icon: 'lucide:cable',
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
