<template>
  <div
    ref="root"
    class="relative shrink-0"
  >
    <button
      ref="trigger"
      type="button"
      class="js-chat-input-tools-trigger btn btn-sm btn-circle btn-ghost btn-ghost-legacy"
      :class="{ 'btn-active': isOpen }"
      aria-label="Add files and tools"
      aria-haspopup="dialog"
      :aria-expanded="isOpen"
      :aria-controls="panelId"
      data-testid="chat-input-tools-trigger"
      @click="toggle"
    >
      <Icon
        name="lucide:plus"
        size="18"
        class="transition-transform duration-200"
        :class="{ 'rotate-45': isOpen }"
      />
    </button>
    <Transition
      v-if="isPopoverLayout"
      enter-active-class="transition-[opacity,scale] duration-150 ease-out origin-bottom-left"
      leave-active-class="transition-[opacity,scale] duration-150 ease-in origin-bottom-left"
      enter-from-class="opacity-0 scale-95"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="hasOpened"
        v-show="isOpen"
        :id="panelId"
        ref="popover"
        role="dialog"
        aria-modal="false"
        :aria-labelledby="headingId"
        data-testid="chat-input-tools-panel"
        class="absolute bottom-full left-0 z-50 mb-2 w-80 max-h-[min(70dvh,36rem)] overflow-y-auto overscroll-contain p-1.5 bg-base-100 rounded-box border border-base-content/10 shadow-xl"
        @focusout="onPopoverFocusOut"
      >
        <h2
          :id="headingId"
          class="sr-only"
        >
          Tools
        </h2>
        <ChatInputToolsMenuContent
          :state="state"
          :highlighted-section="highlightedSection"
          v-bind="contentListeners"
        />
      </div>
    </Transition>
    <dialog
      v-else
      :id="panelId"
      ref="sheet"
      class="js-chat-input-tools-sheet modal modal-bottom"
      :aria-labelledby="headingId"
      data-testid="chat-input-tools-panel"
      @close="onSheetClose"
    >
      <div
        class="modal-box flex flex-col max-h-[85dvh] p-0 pb-[calc(1rem+var(--sab,0px))] rounded-t-box rounded-b-none"
      >
        <div class="shrink-0 px-3 pt-2">
          <div class="w-9 h-1 mx-auto mb-2 rounded-full bg-base-300" />
          <div class="flex items-center justify-between gap-2 px-1">
            <h2
              :id="headingId"
              class="text-base font-bold"
            >
              Tools
            </h2>
            <button
              type="button"
              class="btn btn-sm btn-circle btn-ghost btn-ghost-legacy"
              aria-label="Close tools"
              data-testid="chat-input-tools-close"
              @click="close(true)"
            >
              <Icon
                name="lucide:x"
                size="18"
              />
            </button>
          </div>
          <div
            class="flex items-center gap-1 h-10 px-1 overflow-x-auto no-scrollbar"
            role="group"
            aria-label="Active settings"
            data-testid="chat-input-tools-chips"
          >
            <span
              v-for="tile in tiles"
              :key="tile.id"
              class="inline-flex shrink-0 items-center h-6 rounded-box border text-xs font-semibold"
              :class="getChatInputTileToneClass(tile)"
              :data-testid="`chat-input-tools-chip-${tile.id}`"
            >
              <button
                type="button"
                class="inline-flex items-center h-full min-w-0 px-1.5 rounded-box cursor-pointer"
                :aria-label="tile.ariaLabel"
                @click="focusSection(tile.section)"
              >
                <span class="max-w-48 truncate">{{ tile.chipLabel }}</span>
              </button>
              <button
                v-if="tile.removeLabel"
                type="button"
                class="inline-grid place-items-center size-6 rounded-box cursor-pointer hover:bg-accent/15"
                :aria-label="tile.removeLabel"
                :title="tile.removeLabel"
                :data-testid="`chat-input-tools-chip-${tile.id}-remove`"
                @click="emit('remove-tile', tile.id)"
              >
                <Icon
                  name="lucide:x"
                  size="12"
                />
              </button>
            </span>
            <span
              v-if="!tiles.length"
              class="text-xs text-base-content/60"
            >
              Nothing changed from the defaults
            </span>
          </div>
        </div>
        <div
          ref="sheetScroll"
          class="min-h-0 overflow-y-auto overscroll-contain px-2"
        >
          <ChatInputToolsMenuContent
            v-if="hasOpened"
            :state="state"
            :highlighted-section="highlightedSection"
            v-bind="contentListeners"
          />
        </div>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
      >
        <button aria-label="Close tools">
          close
        </button>
      </form>
    </dialog>
  </div>
</template>

<script setup lang="ts">
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { ExaSearchLevel } from '#shared/utils/exa-search-level'
import type {
  ChatInputTile,
  ChatInputTileId,
  ChatInputToolsState,
  ToolsSection,
} from '~/types/chat-input-tools'
import type { WebSearchSelection } from '~/types/web-search'

withDefaults(defineProps<{
  state: ChatInputToolsState
  tiles?: ChatInputTile[]
}>(), {
  tiles: () => [],
})

const emit = defineEmits<{
  'select-web-search-provider': [value: WebSearchSelection]
  'select-exa-search-level': [level: ExaSearchLevel]
  'toggle-auto-web-search': [isOn: boolean]
  'toggle-image-generation': []
  'select-reasoning-level': [level: ReasoningLevel]
  'save-default-reasoning-level': [level: ReasoningLevel]
  'open-project-picker': []
  'open-files-select': []
  'open-files-upload': []
  'open-files-generated': []
  'update:use-memory': [value: boolean]
  'remove-tile': [id: ChatInputTileId]
}>()

const HIGHLIGHT_DURATION_MS = 1200
const CHECKED_RADIO_SELECTOR = 'input[type="radio"]:checked:not(:disabled)'
const FOCUSABLE_SELECTOR = [
  'input:not(:disabled)',
  'button:not(:disabled)',
  'a[href]',
].join(', ')

const root = useTemplateRef<HTMLDivElement>('root')
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const popover = useTemplateRef<HTMLDivElement>('popover')
const sheet = useTemplateRef<HTMLDialogElement>('sheet')
const sheetScroll = useTemplateRef<HTMLDivElement>('sheetScroll')
const panelId = useId()
const headingId = useId()

const isPopoverLayout = useMediaQuery('(min-width: 48rem)')
const openPopover = useState<'models' | 'tools' | null>(
  'chat-input:open-popover',
  () => null,
)

const hasOpened = shallowRef<boolean>(false)
const isOpen = shallowRef<boolean>(false)
const highlightedSection = shallowRef<ToolsSection | null>(null)
const opener = shallowRef<HTMLElement | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | null = null

function closeAfter<Args extends unknown[]>(
  handler: (...args: Args) => void,
) {
  return (...args: Args) => {
    close(false)
    handler(...args)
  }
}

const contentListeners = {
  'onSelectWebSearchProvider': (value: WebSearchSelection) => {
    emit('select-web-search-provider', value)
  },
  'onSelectExaSearchLevel': (level: ExaSearchLevel) => {
    emit('select-exa-search-level', level)
  },
  'onToggleAutoWebSearch': (isOn: boolean) => {
    emit('toggle-auto-web-search', isOn)
  },
  'onToggleImageGeneration': () => {
    emit('toggle-image-generation')
  },
  'onSelectReasoningLevel': (level: ReasoningLevel) => {
    emit('select-reasoning-level', level)
  },
  'onSaveDefaultReasoningLevel': (level: ReasoningLevel) => {
    emit('save-default-reasoning-level', level)
  },
  'onUpdate:useMemory': (value: boolean) => {
    emit('update:use-memory', value)
  },
  'onOpenProjectPicker': closeAfter(() => {
    emit('open-project-picker')
  }),
  'onOpenFilesSelect': closeAfter(() => {
    emit('open-files-select')
  }),
  'onOpenFilesUpload': closeAfter(() => {
    emit('open-files-upload')
  }),
  'onOpenFilesGenerated': closeAfter(() => {
    emit('open-files-generated')
  }),
}

function getContainer(): HTMLElement | null {
  return isPopoverLayout.value ? popover.value : sheetScroll.value
}

function highlight(section: ToolsSection) {
  if (highlightTimer) {
    clearTimeout(highlightTimer)
  }

  highlightedSection.value = section
  highlightTimer = setTimeout(() => {
    highlightedSection.value = null
    highlightTimer = null
  }, HIGHLIGHT_DURATION_MS)
}

function focusSection(section: ToolsSection | null | undefined) {
  const container = getContainer()

  if (!container) {
    return
  }

  const target = section
    ? container.querySelector<HTMLElement>(`[data-section="${section}"]`)
    : null
  const focusable = target
    ? target.querySelector<HTMLElement>(CHECKED_RADIO_SELECTOR)
    ?? target.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    : container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)

  if (target && section) {
    target.scrollIntoView?.({ block: 'nearest' })
    highlight(section)
  }

  focusable?.focus({ preventScroll: true })
}

async function open(
  section: ToolsSection | null = null,
  origin: HTMLElement | null = null,
) {
  opener.value = origin ?? trigger.value
  hasOpened.value = true
  isOpen.value = true
  openPopover.value = 'tools'

  await nextTick()

  if (!isPopoverLayout.value && sheet.value && !sheet.value.open) {
    sheet.value.showModal()
  }

  await nextTick()

  focusSection(section)
}

function close(restoreFocus: boolean) {
  if (!isOpen.value) {
    return
  }

  isOpen.value = false

  if (openPopover.value === 'tools') {
    openPopover.value = null
  }

  if (sheet.value?.open) {
    sheet.value.close()
  }

  if (restoreFocus) {
    opener.value?.focus()
  }
}

function toggle() {
  if (isOpen.value) {
    close(false)

    return
  }

  open()
}

function onSheetClose() {
  if (!isOpen.value) {
    return
  }

  close(true)
}

function onPopoverFocusOut(event: FocusEvent) {
  const nextTarget = event.relatedTarget

  if (!(nextTarget instanceof Node) || root.value?.contains(nextTarget)) {
    return
  }

  close(false)
}

onKeyStroke('Escape', () => {
  if (!isOpen.value || !isPopoverLayout.value) {
    return
  }

  close(true)
})

onClickOutside(root, () => {
  if (!isOpen.value || !isPopoverLayout.value) {
    return
  }

  close(false)
})

watch(openPopover, (current) => {
  if (current !== 'tools' && isOpen.value) {
    close(false)
  }
})

watch(isPopoverLayout, () => {
  close(false)
})

onBeforeUnmount(() => {
  if (highlightTimer) {
    clearTimeout(highlightTimer)
  }

  if (openPopover.value === 'tools') {
    openPopover.value = null
  }
})

defineExpose({
  open,
  close,
  isOpen,
})
</script>
