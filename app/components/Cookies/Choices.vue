<script setup lang="ts">
defineProps<{
  rejectLabel: string
  acceptLabel: string
  rejectTestId: string
  acceptTestId: string
  stacked?: boolean
}>()

const emit = defineEmits<{
  reject: []
  accept: []
}>()

const buttonClasses = 'btn btn-sm btn-accent btn-block hitslop'
</script>

<template>
  <div
    class="grid gap-1.5"
    :class="stacked ? 'grid-cols-1' : 'grid-cols-2'"
  >
    <button
      type="button"
      :data-testid="rejectTestId"
      :class="buttonClasses"
      @click="emit('reject')"
    >
      {{ rejectLabel }}
    </button>
    <button
      type="button"
      :data-testid="acceptTestId"
      :class="buttonClasses"
      @click="emit('accept')"
    >
      {{ acceptLabel }}
    </button>
  </div>
</template>
