<template>
  <div
    data-testid="chat-loader"
    class="relative h-0 w-full sm:w-4xl sm:max-w-screen mt-3 mx-auto px-4 sm:px-24"
    :class="{
      'opacity-0 pointer-events-none': !show,
    }"
  >
    <div class="absolute top-0">
      <div
        class="chat chat-start w-fit"
      >
        <div
          class="chat-image avatar avatar-placeholder rounded-full overflow-visible"
          :class="{
            'max-sm:hidden': hideAssistantAvatarOnMobile,
          }"
        >
          <div class="bubble w-9 rounded-full bg-base-100 dark:bg-base-content/50">
            <Logo
              short
              animate
              class="size-5 text-text dark:text-base-100 motion-safe:animate-zoom"
            />
          </div>
        </div>
        <UiBubble class="chat-bubble py-3.5 shadow-none w-full">
          <SvgoLoader class="w-4" />
          <span class="sr-only">Loading</span>
        </UiBubble>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  show?: boolean
  hideAssistantAvatarOnMobile?: boolean
}>()
</script>
