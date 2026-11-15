<template>
  <div v-if="controller?.isActive.value">
    <p
      class="sr-only"
      aria-live="polite"
      data-testid="tool-approval-live-region"
    >
      {{ liveText }}
    </p>
    <div
      v-if="pendingCount > 0"
      class="flex px-4 pb-2"
    >
      <button
        type="button"
        class="btn btn-sm btn-warning btn-soft min-h-8 shadow-sm"
        data-testid="tool-approval-chip"
        @click="controller.focusFirstPending()"
      >
        <Icon
          name="lucide:shield-alert"
          class="size-4"
          aria-hidden="true"
        />
        {{ label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const controller = useToolApprovalController()

const pendingCount = computed<number>(() => {
  return controller?.pendingApprovalIds.value.length ?? 0
})

const label = computed<string>(() => {
  const count = pendingCount.value

  return count === 1
    ? '1 action waiting for approval'
    : `${count} actions waiting for approval`
})

const liveText = computed<string>(() => {
  return pendingCount.value > 0 ? 'Action waiting for approval' : ''
})
</script>
