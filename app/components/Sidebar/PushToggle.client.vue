<template>
  <UiButton
    v-if="pushNotifications.isSupported.value"
    mode="primary"
    :icon-only="true"
    circle
    :class="{ 'btn-active': isEnabled }"
    :icon-name="isEnabled ? 'lucide:bell-ring' : 'lucide:bell-off'"
    :title="
      isEnabled
        ? 'Disable push notifications'
        : 'Enable push notifications'
    "
    :disabled="pending"
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
