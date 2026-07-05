<template>
  <LazySidebarSubmenu v-if="loggedIn">
    <template #trigger>
      <UiButton
        ghost
        icon-name="lucide:user-round"
        :icon-only="true"
        title="User Menu"
        :tooltip="undefined"
        circle
        tag="summary"
      />
    </template>
    <UiButton
      ghost
      mode="error"
      icon-name="lucide:log-out"
      :icon-only="true"
      title="Sign out"
      circle
      :disabled="pending"
      @click="signOut"
    />
    <SidebarThemeSwitcher
      :tips="true"
      tips-position="bottom"
    />
    <UiButton
      v-if="showPinToggle"
      ghost
      circle
      :icon-only="true"
      :icon-name="sidebarPinned ? 'lucide:pin-off' : 'lucide:pin'"
      :title="sidebarPinned ? 'Unpin sidebar' : 'Pin sidebar'"
      @click="setSidebarPinned(!sidebarPinned)"
    />
    <UiButton
      to="/profile/keys"
      :disabled="$route.path === '/profile/keys'"
      ghost
      icon-name="lucide:key-round"
      :icon-only="true"
      title="API keys"
      circle
    />
  </LazySidebarSubmenu>
  <template v-else>
    <UiButton
      mode="accent"
      to="/signin"
      :disabled="$route.path === '/signin' || pending"
      icon-name="lucide:log-in"
      :icon-only="true"
      title="Sign in"
      circle
      tooltip-position="left"
      :class="{
        'max-sm:scale-120 max-sm:-translate-y-3': $route.path !== '/signin',
      }"
    />
    <SidebarThemeSwitcher
      :tips="true"
      tips-position="left"
    />
  </template>
</template>
<script setup lang="ts">
const $auth = useAuth()
const { loggedIn } = $auth
const { isDesktop } = useDevice()
const reducedMotion = usePreferredReducedMotion()
const { sidebarPinned, setSidebarPinned } = useUserSetting()

const pending = shallowRef<boolean>(false)

const showPinToggle = computed<boolean>(() => {
  return isDesktop && reducedMotion.value !== 'reduce'
})

async function signOut() {
  pending.value = true

  try {
    await $auth.signOut({
      redirectTo: '/signin',
    })
  } catch (exception: any) {
    throw createError(exception)
  } finally {
    pending.value = false
  }
}
</script>
