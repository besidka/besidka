<template>
  <div class="grid place-items-center w-full min-h-svh p-4">
    <div class="grid place-items-center w-full">
      <div class="grid place-items-center mb-8">
        <Logo class="min-h-auto !m-0" />
      </div>
      <NuxtPage />
    </div>
  </div>
  <div class="fixed top-8 right-8 z-20">
    <ThemeSwitcher
      :tips="true"
      tips-position="left"
    />
  </div>
  <LazyUiCursorGlow v-if="$device.isDesktop" />
</template>
