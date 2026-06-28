<template>
  <div class="flex items-center">
    <figure
      class="shrink-0 rounded-full"
      :class="sizeClass"
    />
  </div>
</template>

<script setup lang="ts">
interface Props {
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
})

const sizeClass = computed(() => {
  const sizeMap: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
    xs: 'size-8',
    sm: 'size-10',
    md: 'size-12',
    lg: 'size-14',
  }

  return `skeleton ${sizeMap[props.size]}`
})
</script>
