<template>
  <div class="chat chat-start w-fit">
    <div
      class="chat-image avatar avatar-placeholder rounded-full overflow-visible"
    >
      <div class="w-10 rounded-full bg-base-100 dark:bg-base-content">
        <Logo
          short
          animate
          class="size-6 text-text dark:text-base-100 motion-safe:animate-zoom"
        />
      </div>
    </div>
    <UiBubble
      class="chat-bubble sm:!px-6 !shadow-none w-full"
    >
      <SvgoLoader class="w-3" />
      <span class="sr-only">Loading</span>
    </UiBubble>
  </div>
</template>
