<template>
  <ClientOnly>
    <LazyPageReloadOnSwipe v-if="$device.isMobileOrTablet" />
  </ClientOnly>
  <div class="relative z-30">
    <div
      class="relative w-full max-w-4xl mx-auto py-8 px-3 sm:px-24"
    >
      <NuxtPage/>
    </div>
  </div>
</template>
