<template>
  <p class="validator-hint">
    {{ error }}
  </p>
</template>

<script setup lang="ts">
defineProps<{
  error: string
}>()
</script>
