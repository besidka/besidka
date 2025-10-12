<template>
  <ClientOnly>
    <LazyPageReloadOnSwipe v-if="$device.isMobileOrTablet" />
  </ClientOnly>
  <div class="sm:grid sm:place-content-center w-full min-h-svh p-4">
    <div class="sm:grid sm:place-items-center w-full sm:min-w-lg pb-20 sm:pb-10">
      <div class="grid place-items-center mb-8">
        <div>
          <LogoLink class="text-base-content" />
        </div>
      </div>
      <NuxtPage />
    </div>
  </div>
</template>
