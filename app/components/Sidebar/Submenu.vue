<template>
  <div
    class="relative group dropdown dropdown-left dropdown-center -mx-2 px-2"
    :class="{
      'dropdown-hover': $device.isDesktop
    }"
  >
    <div class="relative z-[2] group-hover:pointer-events-none">
      <slot name="trigger"/>
    </div>
    <div class="relative !z-[1] dropdown-content translate-x-16 !translate-y-1/2">
      <UiBubble
        class="flex gap-2 !p-2 !rounded-full !pr-18 transition-colors duration-200 !bg-base-100/95"
      >
        <slot />
      </UiBubble>
    </div>
  </div>
</template>
