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
    xs: 'size-8', // 32px - btn-xs
    sm: 'size-10', // 40px - btn-sm
    md: 'size-12', // 48px - btn-md
    lg: 'size-14', // 56px - btn-lg
  }

  return `skeleton ${sizeMap[props.size]}`
})
</script>
