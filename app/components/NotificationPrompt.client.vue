<template>
  <UiAlert
    fixed
    class="-translate-y-full"
    :class="{
      'transition-transform duration-500 ease-in': !mounted,
      'translate-y-0': visible,
      '!hidden': !isVisible,
    }"
    @click="dismiss"
  >
    <span>
      Want to be notified when a response finishes, even if you switch apps?
    </span>
    <div class="mt-2 flex justify-center gap-2">
      <UiButton
        mode="accent"
        text="Enable"
        size="xs"
        @click="enable"
      />
      <UiButton
        ghost
        text="Not now"
        size="xs"
        @click="dismiss"
      />
    </div>
  </UiAlert>
</template>

<script setup lang="ts">
const { mounted, visible } = useAnimateAppear()
const { isVisible, dismiss, enable } = useNotificationPrompt()
</script>
