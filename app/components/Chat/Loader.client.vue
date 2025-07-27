<template>
  <div class="chat chat-start w-fit">
    <div
      class="chat-image avatar avatar-placeholder rounded-full overflow-visible"
    >
      <div class="w-10 rounded-full bg-base-100">
        <Logo
          short
          spinning
          class="size-6 text-accent motion-safe:animate-pulse motion-safe:animate-zoom"
        />
      </div>
    </div>
    <UiBubble
      class="chat-bubble sm:!px-6 !shadow-none w-full"
    >
      <span class="sr-only">Loading</span>...
    </UiBubble>
  </div>
</template>
