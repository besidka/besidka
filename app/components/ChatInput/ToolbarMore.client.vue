<template>
  <details
    ref="dropdown"
    class="dropdown dropdown-top dropdown-end sm:hidden"
  >
    <summary
      class="indicator btn btn-sm btn-ghost btn-circle"
      aria-label="More options"
    >
      <span
        v-if="isAnyFeatureActive"
        class="indicator-item badge badge-accent badge-xs"
      />
      <Icon name="lucide:ellipsis-vertical" size="16" />
    </summary>
    <div class="dropdown-content z-50 w-56 pb-2">
      <div class="bg-base-100 rounded-box w-full shadow-sm">
        <ul class="menu menu-xs w-full">
          <template v-if="isReasoningSupported && reasoningMode === 'toggle'">
            <li>
              <label class="flex items-center gap-2 cursor-pointer">
                <SvgoThinkMedium class="size-4 text-current" />
                <span class="grow">Reasoning</span>
                <input
                  type="checkbox"
                  class="toggle toggle-xs toggle-accent"
                  :checked="isReasoningActive"
                  @change="emit('toggle-reasoning')"
                >
              </label>
            </li>
          </template>
          <template v-if="isReasoningSupported && reasoningMode === 'levels'">
            <ChatInputReasoningMenuItems
              :reasoning="reasoning ?? 'off'"
              :levels="levels ?? []"
              @select-level="emit('select-reasoning-level', $event)"
            />
          </template>
          <li>
            <label class="menu-title text-xs">
              <span class="divider my-0"/>
            </label>
          </li>
          <li v-if="displayFolderPicker">
            <div class="flex items-center gap-2 w-full">
              <button
                type="button"
                class="flex items-center gap-2 grow"
                :class="{
                  'text-accent': folderContext
                }"
                @click="emit('open-folder-picker')"
              >
                <Icon
                  :name="`lucide:folder${folderContext ? '-check' : ''}`"
                  size="16"
                />
                {{ folderContext ? folderContext.name : 'Folder' }}
              </button>
            </div>
          </li>
          <li>
            <button
              type="button"
              class="flex items-center gap-2 w-full"
              @click="emit('open-files-select')"
            >
              <Icon name="lucide:paperclip" size="16" />
              <span class="grow">Attach files</span>
              <span
                v-if="(filesCount ?? 0) > 0"
                class="badge badge-accent badge-xs text-[.5rem]"
              >
                {{ filesCount }}
              </span>
            </button>
          </li>
          <li v-if="isWebSearchSupported">
            <label class="flex items-center gap-2 cursor-pointer">
              <Icon name="lucide:globe" size="16" />
              <span class="grow">Web search</span>
              <input
                type="checkbox"
                class="toggle toggle-xs toggle-accent"
                :checked="isWebSearchEnabled"
                @change="emit('toggle-web-search')"
              >
            </label>
          </li>
        </ul>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import type {
  ReasoningLevel,
  ReasoningEnabledLevel,
} from '#shared/types/reasoning.d'

const props = defineProps<{
  isWebSearchSupported?: boolean
  isWebSearchEnabled?: boolean
  isReasoningSupported?: boolean
  isReasoningActive?: boolean
  reasoningMode?: 'none' | 'toggle' | 'levels'
  reasoning?: ReasoningLevel
  levels?: ReasoningEnabledLevel[]
  displayFolderPicker?: boolean
  folderContext?: {
    id: string
    name: string
  } | null
  filesCount?: number
}>()

const emit = defineEmits<{
  'toggle-web-search': []
  'open-folder-picker': []
  'clear-folder-context': []
  'open-files-select': []
  'open-files-upload': []
  'select-reasoning-level': [level: ReasoningLevel]
  'toggle-reasoning': []
}>()

const { isIos, isAndroid } = useDevice()

const dropdown = useTemplateRef<HTMLDetailsElement>('dropdown')
const isDropdownHovered = useElementHover(dropdown)

const isAnyFeatureActive = computed<boolean>(() => {
  return !!(
    props.isWebSearchEnabled
    || props.isReasoningActive
    || (props.filesCount ?? 0) > 0
    || props.folderContext
  )
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
