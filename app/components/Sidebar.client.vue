<template>
  <div
    class="fixed top-1/2 -translate-y-1/2 right-2 sm:right-4 z-50 transition-all duration-500 ease-in-out"
    :class="{
      'translate-x-0': visible,
      'translate-x-[calc(100%_+_(var(--spacing)_*_10))]': !visible,
    }"
  >
    <UiBubble class="grid gap-2 !rounded-full !p-2">
      <template v-if="session">
        <LazySidebarNewChat />
        <LazySidebarDevelopment />
      </template>
      <SidebarAuthCta />
      <UiButton
        to="/"
        ghost
        :disabled="isHomePage"
        icon-name="lucide:home"
        :icon-only="true"
        title="Go to home page"
        circle
        :tooltip="isHomePage ? null : undefined"
        tooltip-position="left"
      />
    </UiBubble>
  </div>
</template>
<script setup lang="ts">
const { $auth } = useNuxtApp()

const session = $auth.useSession()
const route = useRoute()
const visible = shallowRef<boolean>(false)

onMounted(() => {
  setTimeout(() => {
    visible.value = true
  }, 100)
})

const isHomePage = computed(() => route.fullPath === '/')
</script>
