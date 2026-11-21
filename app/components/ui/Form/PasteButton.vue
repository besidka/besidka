<template>
  <UiButton
    mode="default"
    text="Paste"
    icon-name="lucide:clipboard-paste"
    :icon-size="16"
    icon-only
    circle
    ghost
    size="xs"
    tooltip-position="left"
    :disabled="disabled"
    @click="pasteFromClipboard"
  />
</template>

<script setup lang="ts">
defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  paste: [text: string]
}>()

const { paste } = useClipboardWithPaste()

async function pasteFromClipboard() {
  const text = await paste()

  if (!text) {
    return
  }

  emit('paste', text)
}
</script>
