<template>
  <LazySidebarSubmenu v-if="session">
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
      @click="signOut"
    />
    <SidebarThemeSwitcher
      :tips="true"
      tips-position="bottom"
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
      :disabled="$route.path === '/signin'"
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
const { $auth } = useNuxtApp()

const { data: session } = await $auth.useSession(useFetch)

async function signOut() {
  try {
    await $auth.signOut({
      fetchOptions: {
        onSuccess() {
          navigateTo('/signin')
        },
      },
    })
  } catch (exception: any) {
    useErrorMessage(exception.statusMessage)
    throw createError(exception)
  }
}
</script>
