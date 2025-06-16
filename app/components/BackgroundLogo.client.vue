<template>
  <div
    class="fixed z-20 top-1/2 left-1/2 -translate-1/2 pointer-events-none select-none blur-[2px] saturate-200"
  >
    <div
      class="shrink-0"
      :class="{
        'animate-[spin_2s_linear_infinite]': false
      }"
    >
      <NuxtImg
        v-if="$colorMode.value === 'light'"
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
  </div>
</template>
