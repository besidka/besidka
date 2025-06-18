<template>
  <div
    class="relative group dropdown dropdown-center dropdown-hover sm:-mx-2 sm:px-2"
    :class="{
      'dropdown-top': isMobileSmall,
      'dropdown-left': !isMobileSmall,
    }"
  >
    <div
      class="relative z-[2] group-hover:pointer-events-none"
    >
      <slot name="trigger"/>
    </div>
    <div
      class="relative !z-[1] dropdown-content  max-sm:translate-x-1/2 sm:!translate-x-16 max-sm:translate-y-16 sm:!translate-y-1/2"
    >
      <UiBubble
        class="max-sm:grid sm:flex gap-2 !p-2 !rounded-full max-sm:!rounded-b-none max-sm:!pb-18 sm:!pr-18 transition-colors duration-200 !bg-base-100/95"
      >
        <slot />
      </UiBubble>
    </div>
  </div>
</template>
<script setup lang="ts">
const { isMobileSmall } = useViewport()
</script>
