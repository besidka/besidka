<template>
  <div
    class="fixed max-sm:bottom-0 sm:top-1/2 sm:-translate-y-1/2 right-0 sm:right-4 max-sm:left-0 z-50 transition-transform duration-500 ease-in-out"
    :class="{
      'sm:translate-x-0': visible,
      'sm:translate-x-[calc(100%_+_(var(--spacing)_*_10))]': !visible,
      'max-sm:translate-y-[calc(100%_+_(var(--spacing)_*_10))]':
        !visible || hasOpenDialog,
      'max-sm:!translate-y-[calc(100%+var(--spacing)_*_2)]': !visibleOnScroll,
      'max-sm:translate-y-[calc(var(--spacing)_*_4_+_var(--sab))]':
        visible && isKeyboardVisible && hasSafeAreaBottom && !hasOpenDialog,
      'max-sm:translate-y-0':
        visible && !hasSafeAreaBottom && !hasOpenDialog,
      'max-sm:translate-y-[var(--sab)]':
        visible && !isKeyboardVisible && hasSafeAreaBottom && !hasOpenDialog,
    }"
  >
    <UiBubble
      class="
        grid gap-2
        max-sm:grid-flow-col max-sm:auto-cols-fr max-sm:place-items-center
        !p-2 max-sm:!pb-[calc(var(--spacing)_*_6_+_var(--sab))]
        max-sm:!rounded-none sm:!rounded-full
      "
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
      <template v-if="loggedIn">
        <LazySidebarNewChat />
        <UiButton
          to="/chats/history"
          ghost
          :disabled="$route.path === '/chats/history'"
          icon-name="lucide:history"
          :icon-only="true"
          title="History"
          circle
          tooltip-position="left"
        />
        <LazySidebarDevelopment />
      </template>
    </UiBubble>
  </div>
</template>
<script setup lang="ts">
const route = useRoute()
const { loggedIn } = useAuth()
const { visible } = useAnimateAppear()
const { hasSafeAreaBottom } = useDeviceSafeArea()
const {
  isKeyboardOpen,
} = useDeviceKeyboard()
const { hasOpenDialog } = useOpenDialog()

const isHomePage = computed<boolean>(() => route.fullPath === '/')

const visibleOnScroll = shallowRef<boolean>(true)
const isKeyboardVisible = computed<boolean>(() => {
  return isKeyboardOpen.value
})

const nuxtApp = useNuxtApp()

nuxtApp.hook('chat-input:visibility-changed', (visible) => {
  visibleOnScroll.value = visible
})

onBeforeUnmount(() => {
  visibleOnScroll.value = true
})
</script>
