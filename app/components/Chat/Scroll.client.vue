<template>
  <div
    class="absolute z-20 bottom-full -translate-y-5 max-sm:right-0 sm:left-1/2 sm:-translate-x-1/2 z-50"
  >
    <UiButton
      circle
      icon-name="lucide:chevrons-down"
      icon-only
      title="Scroll to bottom"
       tooltip-position="top"
      class="opacity-50 sm:opacity-20 dark:sm:opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-300 [--depth:0]"
      @click="$nuxt.callHook('chat:scroll-to-bottom')"
    />
  </div>
</template>
