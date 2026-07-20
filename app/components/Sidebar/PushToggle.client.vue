<template>
  <UiButton
    v-if="pushNotifications.isSupported.value"
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
    @click="handleClick"
  />
</template>

<script setup lang="ts">
const pushNotifications = usePushNotifications()
const notificationPrompt = useNotificationPrompt()

const pending = shallowRef<boolean>(false)

const isEnabled = computed<boolean>(() => {
  return pushNotifications.permission.value === 'granted'
    && pushNotifications.isSubscribed.value
})

const isBlocked = computed<boolean>(() => {
  return pushNotifications.permission.value === 'denied'
})

async function handleClick() {
  if (pending.value) {
    return
  }

  pending.value = true

  try {
    if (isEnabled.value) {
      await notificationPrompt.disable()
    } else {
      await notificationPrompt.requestEnable()
    }
  } finally {
    pending.value = false
  }
}
</script>
