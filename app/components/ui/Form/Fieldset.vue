<template>
  <fieldset class="fieldset grid gap-4 sm:gap-8 w-full">
    <legend
      v-if="legend"
      class="fieldset-legend"
    >
      {{ legend }}
    </legend>
    <slot />
  </fieldset>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  legend?: string
  inputs?: boolean
}>(), {
  legend: '',
  inputs: true,
})
</script>
