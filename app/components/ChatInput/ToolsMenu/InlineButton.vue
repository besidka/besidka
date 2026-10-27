<template>
  <button
    ref="button"
    type="button"
    class="rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    :class="isPending
      ? 'cursor-default text-base-content/60'
      : 'cursor-pointer text-accent hover:underline'"
    :aria-disabled="isPending || undefined"
    @click="onClick"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
const props = defineProps<{
  isPending?: boolean
}>()

const emit = defineEmits<{
  click: []
}>()

const button = useTemplateRef<HTMLButtonElement>('button')

useToolsMenuFocusRescue(button)

function onClick() {
  if (props.isPending) {
    return
  }

  emit('click')
}
</script>
