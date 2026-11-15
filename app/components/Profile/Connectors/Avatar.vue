<template>
  <div
    class="avatar avatar-placeholder shrink-0"
    aria-hidden="true"
    data-testid="connector-avatar"
  >
    <div
      class="rounded-full bg-base-300 text-base-content"
      :class="size === 'lg' ? 'w-10' : 'w-8'"
    >
      <span :class="size === 'lg' ? 'text-base' : 'text-sm'">
        {{ initial }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  title: string
  size?: 'md' | 'lg'
}>(), {
  size: 'md',
})

const initial = computed<string>(() => {
  return getConnectorInitial(props.title)
})
</script>
