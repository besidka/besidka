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
      />
    </template>
    <UiButton
      ghost
      mode="error"
      class="light:[--color-error:var(--color-red-950)]"
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
      disabled
      mode="error"
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
    />
    <SidebarThemeSwitcher
      :tips="true"
      tips-position="left"
    />
  </template>
</template>
<script setup lang="ts">
const { $auth } = useNuxtApp()

const session = $auth.useSession()

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
