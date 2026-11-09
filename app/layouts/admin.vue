<template>
  <div class="relative z-30">
    <div class="relative w-full max-w-4xl mx-auto py-8 px-3 sm:px-24">
      <div class="pb-24">
        <div class="mb-8 flex items-center justify-between gap-4">
          <UiButton
            to="/chats/new"
            ghost
            mode="default"
            normal-case
            size="sm"
            text="Back to Chat"
            class="group/cta"
          >
            <template #icon>
              <Icon
                name="lucide:arrow-left"
                size="20"
                class="cta-icon-left"
              />
            </template>
          </UiButton>
          <SidebarThemeSwitcher
            show-label
            mode="default"
            size="sm"
          />
        </div>
        <div class="mb-8 text-center">
          <h1 class="inline-flex items-center gap-2 text-4xl font-bold">
            <Icon
              name="lucide:shield-ellipsis"
              size="32"
              aria-hidden="true"
            />
            Admin
          </h1>
          <p class="mt-2">Feature access and content reports</p>
        </div>
        <nav
          aria-label="Admin sections"
          class="tabs tabs-box tabs-sm mb-12 w-full"
        >
          <NuxtLink
            v-for="tab in tabs"
            :key="tab.to"
            :to="tab.to"
            class="tab grow gap-1"
            :class="{ 'tab-active': isTabActive(tab.to) }"
            :data-testid="`admin-tab-${tab.id}`"
          >
            <Icon :name="tab.icon" size="16" />
            <span :class="{ 'max-lg:sr-only': !isTabActive(tab.to) }">
              {{ tab.label }}
            </span>
          </NuxtLink>
        </nav>
        <NuxtPage />
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
const currentRoute = useRoute()

const tabs = [
  {
    id: 'features',
    to: '/admin/features',
    label: 'Features',
    icon: 'lucide:flag',
  },
  {
    id: 'users',
    to: '/admin/users',
    label: 'Users',
    icon: 'lucide:users',
  },
  {
    id: 'reports',
    to: '/admin/artifact-reports',
    label: 'Reports',
    icon: 'lucide:flag-triangle-right',
  },
  {
    id: 'audit',
    to: '/admin/audit',
    label: 'Audit',
    icon: 'lucide:scroll-text',
  },
]

function isTabActive(to: string): boolean {
  return currentRoute.path === to || currentRoute.path.startsWith(`${to}/`)
}
</script>
