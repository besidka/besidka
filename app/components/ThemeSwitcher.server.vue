<template>
  <div class="flex items-center">
    <figure
      class="shrink-0 skeleton size-6 rounded-full"
      :class="{
        'mr-2': !tips,
      }"
    />
    <span
      v-show="!tips"
      class="skeleton w-full h-6"
    />
  </div>
</template>

<script setup lang="ts">
interface Props {
  tips?: boolean
}

defineProps<Props>()
</script>
