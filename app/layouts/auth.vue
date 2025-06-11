<template>
  <div>
    <div class="grid place-items-center w-full min-h-svh p-4">
      <div class="grid place-items-center w-full">
        <div class="grid place-items-center mb-8">
          <Logo class="min-h-auto !m-0" />
        </div>
        <NuxtPage />
      </div>
    </div>
    <div class="fixed bottom-4 right-4 z-20">
      <UiBubble class="flex flex-col align-center gap-2 !rounded-full !p-2">
        <div class="tooltip tooltip-left" data-tip="Go to sign in page">
          <Logo :as-link="false" :short="true" class="min-h-auto !m-0" />
        </div>
        <ThemeSwitcher
          :tips="true"
          tips-position="left"
        />
      </UiBubble>
    </div>
    <LazyUiCursorGlow v-if="$device.isDesktop" />
  </div>
</template>
