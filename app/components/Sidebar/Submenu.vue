<template>
  <details
    ref="modelDropdown"
    class="relative group dropdown dropdown-center sm:-mx-2 sm:px-2"
    :class="{
      'dropdown-top': isMobileSmall,
      'dropdown-left': !isMobileSmall,
    }"
  >
    <slot name="trigger"/>
    <div
      class="relative !z-[1] dropdown-content max-sm:translate-x-1/2 sm:!translate-x-16 max-sm:translate-y-16 sm:!translate-y-1/2"
    >
      <UiBubble
        class="max-sm:grid sm:flex gap-2 !p-2 !rounded-full max-sm:!pb-18 sm:!pr-18 transition-colors duration-200 !bg-base-100/95"
      >
        <slot />
      </UiBubble>
    </div>
  </details>
</template>
<script setup lang="ts">
const { isMobileSmall } = useViewport()
const { isDesktop } = useDevice()

const modelDropdown = useTemplateRef<HTMLDetailsElement>('modelDropdown')
const isDropdownHovered = useElementHover(modelDropdown)

onClickOutside(modelDropdown, () => {
  if (modelDropdown.value?.open) {
    modelDropdown.value.open = false
  }
})

watch(isDropdownHovered, (hovered) => {
  if (!modelDropdown.value || !isDesktop) {
    return
  }

  modelDropdown.value.open = hovered
}, {
  immediate: false,
  flush: 'post',
})
</script>
