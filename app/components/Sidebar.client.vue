<template>
  <div
    class="fixed max-sm:bottom-0 sm:top-1/2 sm:-translate-y-1/2 right-0 sm:right-4 max-sm:left-0 z-50"
    :class="{
      'transition-transform duration-500 ease-out': !mounted,
      'max-sm:translate-y-0 sm:translate-x-0': visible,
      'sm:translate-x-[calc(100%_+_(var(--spacing)_*_10))]': !visible,
      'max-sm:translate-y-[calc(100%_+_(var(--spacing)_*_10))]': !visible,
    }"
  >
    <UiBubble
      class="grid max-sm:grid-flow-col max-sm:auto-cols-fr max-sm:place-items-center gap-2 max-sm:!rounded-none sm:!rounded-full !p-2"
    >
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
      <SidebarAuthCta />
      <template v-if="session">
        <LazySidebarNewChat />
        <LazySidebarDevelopment />
      </template>
    </UiBubble>
  </div>
</template>
<script setup lang="ts">
const { $auth } = useNuxtApp()

const { data: session } = await $auth.useSession(useFetch)

const route = useRoute()
const mounted = shallowRef<boolean>(false)
const visible = shallowRef<boolean>(false)

onMounted(() => {
  setTimeout(() => {
    visible.value = true
  }, 100)
  setTimeout(() => {
    mounted.value = true
  }, 600)
})

onBeforeUnmount(() => {
  mounted.value = false
})

const isHomePage = computed(() => route.fullPath === '/')
</script>
