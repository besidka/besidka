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
        tabindex="-1"
        data-testid="chat-input-tools-panel"
        class="absolute bottom-full left-0 z-50 mb-2 w-80 flex flex-col overflow-hidden bg-base-100 rounded-box border border-base-content/10 shadow-xl outline-none"
        :style="{ maxHeight: `${popoverMaxHeight}px` }"
        @focusout="onPopoverFocusOut"
      >
        <h2
          :id="headingId"
          class="sr-only"
        >
          Tools
        </h2>
        <div
          ref="popoverScroll"
          class="min-h-0 overflow-y-auto overscroll-contain p-1.5"
          :style="popoverFadeStyle"
          data-testid="chat-input-tools-scroll"
        >
          <ChatInputToolsMenuContent
            :state="state"
            :highlighted-section="highlightedSection"
            v-bind="contentListeners"
          />
        </div>
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
        ref="sheetBox"
        tabindex="-1"
        autofocus
        class="modal-box flex flex-col max-h-[85dvh] p-0 rounded-t-box rounded-b-none outline-none"
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
            v-if="tiles.length"
            ref="chipRow"
            class="flex items-center gap-1 h-10 px-1 overflow-x-auto no-scrollbar"
            :style="chipRowFadeStyle"
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
          </div>
        </div>
        <div
          ref="sheetScroll"
          data-testid="chat-input-tools-sheet-scroll"
          class="min-h-0 overflow-y-auto overscroll-contain px-2 pb-[max(calc(1rem+var(--sab,0px)),env(safe-area-inset-bottom))]"
          :style="sheetFadeStyle"
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

const props = withDefaults(defineProps<{
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

const POPOVER_GAP_PX = 8
const POPOVER_VIEWPORT_MARGIN_PX = 12
const POPOVER_MIN_HEIGHT_PX = 160
const POPOVER_FALLBACK_HEIGHT_PX = 576

const root = useTemplateRef<HTMLDivElement>('root')
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const popover = useTemplateRef<HTMLDivElement>('popover')
const popoverScroll = useTemplateRef<HTMLDivElement>('popoverScroll')
const sheet = useTemplateRef<HTMLDialogElement>('sheet')
const sheetBox = useTemplateRef<HTMLDivElement>('sheetBox')
const sheetScroll = useTemplateRef<HTMLDivElement>('sheetScroll')
const chipRow = useTemplateRef<HTMLDivElement>('chipRow')
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
const popoverMaxHeight = shallowRef<number>(POPOVER_FALLBACK_HEIGHT_PX)
const lastInteraction = shallowRef<'keyboard' | 'pointer'>('keyboard')
let highlightTimer: ReturnType<typeof setTimeout> | null = null

const {
  fadeStyle: popoverFadeStyle,
  update: updatePopoverFade,
} = useScrollEdgeFade(popoverScroll)
const {
  fadeStyle: sheetFadeStyle,
  update: updateSheetFade,
} = useScrollEdgeFade(sheetScroll)
const { fadeStyle: chipRowFadeStyle } = useScrollEdgeFade(chipRow, 'x')

useEventListener(document, 'pointerdown', () => {
  lastInteraction.value = 'pointer'
}, { capture: true, passive: true })
useEventListener(document, 'keydown', () => {
  lastInteraction.value = 'keyboard'
}, { capture: true, passive: true })

function updatePopoverMaxHeight() {
  const triggerTop = trigger.value?.getBoundingClientRect().top

  if (triggerTop === undefined) {
    return
  }

  popoverMaxHeight.value = Math.max(
    POPOVER_MIN_HEIGHT_PX,
    Math.floor(triggerTop - POPOVER_GAP_PX - POPOVER_VIEWPORT_MARGIN_PX),
  )
}

useEventListener(window, 'resize', () => {
  if (!isOpen.value) {
    return
  }

  updatePopoverMaxHeight()
}, { passive: true })

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
  return isPopoverLayout.value ? popoverScroll.value : sheetScroll.value
}

function getDialogElement(): HTMLElement | null {
  return isPopoverLayout.value ? popover.value : sheetBox.value
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

  if (lastInteraction.value === 'pointer') {
    getDialogElement()?.focus({ preventScroll: true })

    return
  }

  focusable?.focus({ preventScroll: true })
}

async function open(
  section: ToolsSection | null = null,
  origin: HTMLElement | null = null,
) {
  opener.value = origin ?? trigger.value
  updatePopoverMaxHeight()
  hasOpened.value = true
  isOpen.value = true
  openPopover.value = 'tools'

  await nextTick()

  if (!isPopoverLayout.value && sheet.value && !sheet.value.open) {
    sheet.value.showModal()
  }

  await nextTick()

  focusSection(section)
  updatePopoverFade()
  updateSheetFade()
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

/**
 * The chip row mounts above the sheet's scroll area when the first setting
 * changes, so the scroll offset absorbs its height and the control the user
 * just tapped stays under their finger.
 */
watch(() => props.tiles.length > 0, async () => {
  const scrollArea = sheetScroll.value

  if (!scrollArea || !sheet.value?.open) {
    return
  }

  const topBefore = scrollArea.getBoundingClientRect().top

  await nextTick()

  const shift = scrollArea.getBoundingClientRect().top - topBefore

  if (shift !== 0) {
    scrollArea.scrollTop += shift
  }
}, { flush: 'pre' })

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
