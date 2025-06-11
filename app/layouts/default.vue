<template>
  <div>
    <ClientOnly>
      <div class="fixed z-20 top-1/2 left-1/2 -translate-1/2 pointer-events-none select-none blur-[2px] saturate-200">
        <NuxtImg
          v-if="colorMode.value === 'light'"
          src="/logo.svg"
          alt="Logo"
          width="300"
          height="300"
          class="opacity-2"
        />
        <NuxtImg
          v-else
          src="/logo-light.svg"
          alt="Logo"
          width="300"
          height="300"
          class="opacity-1"
        />
      </div>
    </ClientOnly>
    <div class="relative z-30">
      <slot/>
    </div>
    <div class="fixed top-1/2 -translate-y-1/2 right-2 sm:right-4 z-50">
      <UiBubble class="flex flex-col align-center gap-2 !rounded-full !p-2">
        <div class="tooltip tooltip-left" data-tip="Go to home page">
          <Logo :as-link="false" :short="true" class="min-h-auto !m-0" />
        </div>
        <ThemeSwitcher
          :tips="true"
          tips-position="left"
        />
        <ins class="my-0.5 divider"/>
        <UiButton
          icon-name="lucide:log-out"
          :icon-only="true"
          title="Sign out"
          circle
          tooltip-position="left"
          @click="signOut"
        />
      </UiBubble>
    </div>
    <LazyUiCursorGlow v-if="$device.isDesktop" />
  </div>
</template>

<script setup lang="ts">
const colorMode = useColorMode()

async function signOut() {
  try {
    await $fetch('/api/v1/auth/sign-out', {
      method: 'post',
    })

    await navigateTo('/signin')
  } catch (exception: any) {
    useErrorMessage(exception.statusMessage)
    throw createError(exception)
  }
}
</script>
