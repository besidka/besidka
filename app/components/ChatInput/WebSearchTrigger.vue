<template>
  <details
    ref="dropdown"
    class="dropdown dropdown-top"
    :class="{
      'dropdown-end': align === 'end',
      'max-xs:dropdown-start xs:dropdown-end': align !== 'end',
    }"
  >
    <summary
      data-testid="web-search-trigger"
      class="btn btn-xs btn-accent btn-ghost btn-ghost-legacy rounded-full"
      :class="{
        'btn-active': isActive || isDropdownHovered,
        'pl-[5px]': isActive,
        'btn-circle': !isActive,
      }"
      aria-label="Choose a web search provider"
      :title="triggerTitle"
    >
      <ProviderIcon
        v-if="selectedProviderId"
        :provider-id="selectedProviderId"
        class="!size-4"
      />
      <Icon v-else name="lucide:globe" class="!size-4 text-current" />
      <span v-if="isActive">{{ triggerLabel }}</span>
    </summary>
    <ClientOnly>
      <div class="dropdown-content z-50 w-56 pb-2">
        <div class="bg-base-100 rounded-box w-full shadow-sm">
          <ul class="menu menu-xs w-full">
            <ChatInputWebSearchMenuItems
              :selected="selected"
              :options="options"
              :is-tool-calling-supported="isToolCallingSupported"
              @select-provider="emit('select-provider', $event)"
            />
          </ul>
        </div>
      </div>
    </ClientOnly>
  </details>
</template>

<script setup lang="ts">
import type {
  WebSearchOption,
  WebSearchSelection,
} from '~/types/web-search'

const props = defineProps<{
  selected: WebSearchSelection
  options: WebSearchOption[]
  isToolCallingSupported: boolean
  align?: 'start' | 'end'
}>()

const emit = defineEmits<{
  'select-provider': [value: WebSearchSelection]
}>()

const { isIos, isAndroid } = useDevice()

const dropdown = useTemplateRef<HTMLDetailsElement>('dropdown')
const isDropdownHovered = useElementHover(dropdown)

const isActive = computed<boolean>(() => {
  return props.selected !== 'off'
})

const triggerLabel = computed<string>(() => {
  return isActive.value ? 'Search' : ''
})

const selectedProviderId = computed<string | undefined>(() => {
  if (props.selected === 'web_search_brave') {
    return 'brave'
  }

  if (props.selected === 'web_search_exa') {
    return 'exa'
  }

  return undefined
})

const providerTitles: Record<Exclude<WebSearchSelection, 'off'>, string> = {
  web_search: 'Model\'s built-in search',
  web_search_brave: 'Brave',
  web_search_exa: 'Exa',
}

const triggerTitle = computed<string>(() => {
  if (props.selected === 'off') {
    return 'Choose a web search provider'
  }

  return `Web search: ${providerTitles[props.selected]}`
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
</script>
