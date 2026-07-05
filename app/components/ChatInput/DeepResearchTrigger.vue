<template>
  <details
    ref="dropdown"
    class="dropdown dropdown-top"
    :class="{
      'dropdown-end': isWebSearchEnabled,
      'max-xs:dropdown-start xs:dropdown-end': !isWebSearchEnabled
    }"
  >
    <summary
      data-testid="deep-research-trigger"
      class="btn btn-xs btn-accent btn-ghost btn-ghost-legacy rounded-full"
      :class="{
        'btn-active': isResearchActive || isDropdownHovered,
        'pl-[5px]': isResearchActive,
        'btn-circle': !isResearchActive,
      }"
      aria-label="Set research depth"
      :title="`Deep research: ${researchDepth}`"
    >
      <Icon name="lucide:telescope" size="16" class="text-current" />
      <span v-if="isResearchActive" class="capitalize">
        {{ researchDepth }}
      </span>
    </summary>
    <ClientOnly>
      <div class="dropdown-content z-50 w-44 pb-2">
        <div class="bg-base-100 rounded-box w-full shadow-sm">
          <ul class="menu menu-xs w-full">
            <ChatInputDeepResearchMenuItems
              :research-depth="researchDepth"
              @select-research-depth="selectDepth"
            />
          </ul>
        </div>
      </div>
    </ClientOnly>
  </details>
</template>

<script setup lang="ts">
import type { ResearchDepthSetting } from '#shared/types/research.d'

defineProps<{
  isWebSearchEnabled?: boolean
}>()

const researchDepth = defineModel<ResearchDepthSetting>('researchDepth', {
  default: 'off',
})

const { isIos, isAndroid } = useDevice()

const dropdown = useTemplateRef<HTMLDetailsElement>('dropdown')
const isDropdownHovered = useElementHover(dropdown)

const isResearchActive = computed<boolean>(() => {
  return isDeepResearchActive(researchDepth.value)
})

onClickOutside(dropdown, () => {
  if (dropdown.value?.open) {
    dropdown.value.open = false
  }
})

watch(isDropdownHovered, (hovered) => {
  if (!dropdown.value || isIos || isAndroid) {
    return
  }

  dropdown.value.open = hovered
}, {
  immediate: false,
  flush: 'post',
})

function selectDepth(depth: ResearchDepthSetting) {
  researchDepth.value = depth
}
</script>
