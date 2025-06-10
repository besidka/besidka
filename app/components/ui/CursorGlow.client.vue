<template>
  <ins
    class="max-md:hidden pointer-events-none fixed z-10 size-[300px] radius-full blur-xl transform-[translate3d(0, 0, 0)] opacity-10 dark:opacity-20 cursor-glow"
    :style="styles"
  />
</template>

<script setup lang="ts">
const { x, y } = useMouse()

const props = withDefaults(defineProps<{
  size?: number
}>(), {
  size: 300,
})

const styles = computed<{
  top: string
  left: string
}>(() => ({
  top: `${y.value - props.size / 2}px`,
  left: `${x.value - props.size / 2}px`,
}))
</script>

<style scoped>
@reference "~/assets/css/main.css";

.cursor-glow {
 background: radial-gradient(
  circle,
    var(--color-pink-200) 0%,
    var(--color-pink-400) 30%,
    var(--color-pink-500) 40%,
    transparent 80%
  )
}
</style>
