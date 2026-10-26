<template>
  <UiButton
    v-if="isSupported"
    :ghost="!isEnabled"
    :mode="isEnabled ? 'accent' : 'primary'"
    :icon-only="true"
    circle
    :class="{ 'btn-active': isEnabled }"
    :icon-name="isEnabled ? 'lucide:bell-ring' : 'lucide:bell-off'"
    :title="
      isBlocked
        ? 'Notifications blocked in browser settings'
        : isEnabled
          ? 'Disable push notifications'
          : 'Enable push notifications'
    "
    :disabled="pending || isBlocked"
    @click="toggle"
  />
</template>

<script setup lang="ts">
const { isSupported, isEnabled, isBlocked, pending, toggle } = usePushToggle()
</script>
