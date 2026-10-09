<script setup lang="ts">
defineProps<{
  rejectLabel: string
  acceptLabel: string
  rejectTestId: string
  acceptTestId: string
}>()

const emit = defineEmits<{
  reject: []
  accept: []
}>()

const buttonClasses = 'btn btn-sm btn-accent btn-block hitslop'
</script>

<template>
  <div class="grid grid-cols-2 gap-1.5">
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
