<template>
  <UiButton
    :to="destination"
    ghost
    size="sm"
    icon-name="lucide:house"
    :icon-size="16"
    icon-only-phone
    title="Open Besidka"
    text="Besidka"
    normal-case
    :tooltip="null"
    class="shrink-0 min-h-6 max-sm:btn-square"
    data-testid="shared-exit-link"
  />
</template>

<script setup lang="ts">
const { loggedIn } = useAuth()

const destination = computed<string>(() => {
  return loggedIn.value ? '/chats/new' : '/'
})
</script>
