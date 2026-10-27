<template>
  <div
    class="grid transition-[grid-template-rows,visibility] duration-160 ease-out motion-reduce:transition-none"
    :class="isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] invisible'"
    :inert="!isOpen"
    :data-open="isOpen"
  >
    <div
      ref="panel"
      class="min-h-0 overflow-hidden"
    >
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  isOpen: boolean
}>()

const panel = useTemplateRef<HTMLDivElement>('panel')

provideRevealScope(() => props.isOpen)

watch(() => props.isOpen, (isOpenNow) => {
  const element = panel.value
  const content = element?.closest(TOOLS_MENU_CONTENT_SELECTOR)

  if (
    isOpenNow
    || !element
    || !content
    || !element.contains(document.activeElement)
  ) {
    return
  }

  restoreToolsMenuFocus(content, { force: true, near: element })
}, { flush: 'pre' })
</script>
