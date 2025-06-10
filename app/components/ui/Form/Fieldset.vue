<template>
  <fieldset
  class="fieldset grid gap-8 w-full"
  :class="{ 'pr-4': inputs}"
  >
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
