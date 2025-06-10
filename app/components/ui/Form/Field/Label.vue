<template>
  <p
    v-for="(item, index) in labels"
    :key="index"
    class="fieldset-label"
    :class="{
      'mb-2 text-base-content font-bold': position === 'before',
      'mt-2 text-base-content/80': position === 'after',
    }"
  >
    {{ item }}
  </p>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  label?: MaybeRefOrGetter<string | string[]>
  position?: 'before' | 'after'
}>(), {
  label: '',
  position: 'before',
})

const labels = computed<string[]>(() => {
  const label = toValue(props.label)

  if (!label) {
    return []
  }

  return Array.isArray(label)
    ? label
    : [label]
})
</script>
