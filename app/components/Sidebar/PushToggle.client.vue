<template>
  <UiButton
    v-if="isSupported"
    :ghost="!isActive"
    :mode="isActive ? 'accent' : 'primary'"
    :icon-only="true"
    circle
    :class="{ 'btn-active': isActive }"
    :icon-name="iconName"
    :title="title"
    :disabled="!isStateKnown || pending || isBlocked"
    @click="toggle"
  />
</template>

<script setup lang="ts">
const {
  isSupported,
  isStateKnown,
  isEnabled,
  isBlocked,
  pending,
  toggle,
} = usePushToggle()

const isActive = computed<boolean>(() => {
  return isStateKnown.value && isEnabled.value
})

const iconName = computed<string>(() => {
  if (!isStateKnown.value) {
    return 'lucide:bell'
  }

  return isEnabled.value ? 'lucide:bell-ring' : 'lucide:bell-off'
})

const title = computed<string>(() => {
  if (!isStateKnown.value) {
    return 'Checking notification status'
  }

  if (isBlocked.value) {
    return 'Notifications blocked in browser settings'
  }

  return isEnabled.value
    ? 'Disable push notifications'
    : 'Enable push notifications'
})
</script>
