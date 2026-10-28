<template>
  <div
    ref="root"
    class="relative"
  >
    <button
      ref="trigger"
      type="button"
      aria-label="Select model"
      data-testid="current-model-trigger"
      class="btn btn-ghost btn-sm rounded-full [--size:calc(var(--size-field)_*_6)] transition-colors duration-200 max-xxs:max-w-40"
      :class="{ 'btn-active': isOpen }"
      :aria-haspopup="isPopoverLayout ? 'listbox' : 'dialog'"
      :aria-expanded="isOpen"
      :aria-controls="panelId"
      @click="toggle"
    >
      <ProviderIcon
        v-if="selectedIconProviderId"
        :provider-id="selectedIconProviderId"
        class="!size-4 text-base-content/40"
      />
      <span class="block truncate text-left min-w-0">
        {{ selectedModelName }}
      </span>
      <Icon
        name="lucide:chevron-down"
        size="14"
        :class="{ 'scale-y-[-1]': isOpen }"
      />
    </button>
    <ClientOnly>
      <Transition
        v-if="isPopoverLayout"
        enter-active-class="transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-bottom"
        leave-active-class="transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-bottom"
        enter-from-class="opacity-0 scale-95"
        leave-to-class="opacity-0 scale-95"
        @after-leave="resetTransientState"
      >
        <div
          v-if="hasOpened"
          v-show="isOpen"
          :id="panelId"
          data-testid="models-picker-panel"
          class="absolute bottom-full left-0 z-50 mb-2 w-[min(30rem,calc(100vw-4rem))]"
        >
          <ChatInputModelsTriggerPanel
            ref="panel"
            :is-open="isOpen"
            :selected-model-id="selectedModelId"
            :selected-gateway-id="selectedGatewayId"
            @select="onSelect"
            @close="onClose"
          />
        </div>
      </Transition>
      <dialog
        v-else
        :id="panelId"
        ref="sheet"
        class="js-models-picker-sheet modal modal-bottom"
        :aria-labelledby="headingId"
        data-testid="models-picker-panel"
        @cancel="onSheetCancel"
        @close="onSheetClose"
      >
        <div
          ref="sheetBox"
          tabindex="-1"
          autofocus
          data-testid="models-picker-sheet-box"
          class="modal-box flex flex-col h-[85dvh] p-0 overflow-hidden rounded-t-box rounded-b-none outline-none [--models-sheet-bottom-padding:max(calc(1rem+var(--sab,0px)),env(safe-area-inset-bottom))]"
          :style="sheetBoxStyle"
        >
          <div class="shrink-0 px-3 pt-2">
            <div class="w-9 h-1 mx-auto mb-2 rounded-full bg-base-300" />
            <div class="flex items-center justify-between gap-2 px-1">
              <h2
                :id="headingId"
                class="text-base font-bold"
              >
                Models
              </h2>
              <button
                type="button"
                class="btn btn-sm btn-circle btn-ghost btn-ghost-legacy"
                aria-label="Close models"
                data-testid="models-picker-close"
                @click="closeAndRestoreFocus"
              >
                <Icon
                  name="lucide:x"
                  size="18"
                />
              </button>
            </div>
          </div>
          <ChatInputModelsTriggerPanel
            v-if="hasOpened"
            ref="panel"
            layout="sheet"
            :inert="isSheetPanelInert"
            :is-open="isOpen"
            :selected-model-id="selectedModelId"
            :selected-gateway-id="selectedGatewayId"
            @select="onSelect"
            @close="onClose"
          />
        </div>
        <form
          method="dialog"
          class="modal-backdrop"
        >
          <button
            aria-label="Close models"
            data-testid="models-picker-backdrop"
          >
            close
          </button>
        </form>
      </dialog>
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import type { StyleValue } from 'vue'
import type { GatewayId } from '#shared/types/gateways.d'

interface PanelHandle {
  prepareOpen: () => Promise<void>
  resetTransientState: () => void
  handleEscape: () => boolean
}

const SHEET_KEYBOARD_HEIGHT_RATIO = 0.85
const SHEET_KEYBOARD_BOTTOM_PADDING = '0.375rem'

const { selection } = useUserModel()
const {
  name: selectedModelName,
  iconProviderId: selectedIconProviderId,
} = useSelectedModelInfo()

const hasOpened = shallowRef<boolean>(false)
const isOpen = shallowRef<boolean>(false)
const root = useTemplateRef<HTMLDivElement>('root')
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const panel = useTemplateRef<PanelHandle>('panel')
const sheet = useTemplateRef<HTMLDialogElement>('sheet')
const sheetBox = useTemplateRef<HTMLDivElement>('sheetBox')
const isSheetPanelInert = shallowRef<boolean>(false)
const panelId = useId()
const headingId = useId()
const isPopoverLayout = useMediaQuery('(min-width: 48rem)')
const openPopover = useState<'models' | 'tools' | null>(
  'chat-input:open-popover',
  () => null,
)
const {
  bottomInset,
  viewportHeight,
  isKeyboardOpen,
} = useVisualViewportInset()

const selectedModelId = computed<string>(() => {
  return selection.value.modelId
})

const selectedGatewayId = computed<GatewayId | null>(() => {
  const current = selection.value

  return current.source === 'gateway' ? current.gatewayId : null
})

/**
 * `dvh` ignores the on-screen keyboard, so while it is up the sheet sits on
 * the visual viewport instead: lifted by the covered height and sized to
 * what stays visible, with no safe-area padding under the gateway row.
 */
const sheetBoxStyle = computed<StyleValue>(() => {
  if (!isOpen.value || !isKeyboardOpen.value) {
    return {}
  }

  const height = Math.round(
    viewportHeight.value * SHEET_KEYBOARD_HEIGHT_RATIO,
  )

  return {
    'height': `${height}px`,
    'marginBottom': `${bottomInset.value}px`,
    '--models-sheet-bottom-padding': SHEET_KEYBOARD_BOTTOM_PADDING,
  }
})

function resetTransientState() {
  panel.value?.resetTransientState()
}

function close() {
  isOpen.value = false

  if (openPopover.value === 'models') {
    openPopover.value = null
  }

  if (sheet.value?.open) {
    sheet.value.close()
  }
}

function closeAndRestoreFocus() {
  close()
  trigger.value?.focus()
}

/**
 * iOS WebKit ignores the box's `autofocus` when `showModal()` picks the
 * initial focus and takes the first link or text field instead, which opens
 * the keyboard over the list. The panel is therefore inert while the dialog
 * opens (set before the render that precedes this call), and the box takes
 * focus explicitly before the panel is released.
 */
function showSheet(dialog: HTMLDialogElement) {
  try {
    dialog.showModal()
    sheetBox.value?.focus({ preventScroll: true })
  } finally {
    isSheetPanelInert.value = false
  }
}

/**
 * A mounted panel is prepared in the same tick `isOpen` flips, so no frame
 * renders stale search or filter state. On the first open there is no panel
 * yet; it mounts already open and prepares itself from setup. The sheet is
 * shown only after that render, so its first frame is already prepared.
 */
async function toggle() {
  if (isOpen.value) {
    close()

    return
  }

  const mountedPanel = panel.value

  hasOpened.value = true
  isOpen.value = true
  openPopover.value = 'models'
  mountedPanel?.prepareOpen()

  if (isPopoverLayout.value) {
    return
  }

  isSheetPanelInert.value = true
  await nextTick()

  if (!isOpen.value || !sheet.value || sheet.value.open) {
    isSheetPanelInert.value = false

    return
  }

  showSheet(sheet.value)
}

/**
 * Escape and the Android back gesture both reach the sheet as `cancel`. The
 * panel unwinds an open detail, the inline filters or a search first; only
 * when it has nothing left does the native close run. Chrome makes a repeated
 * `cancel` without new user activation uncancelable, so the sheet can never
 * trap the back gesture.
 */
function onSheetCancel(event: Event) {
  if (!panel.value?.handleEscape()) {
    return
  }

  event.preventDefault()
}

function onSheetClose() {
  if (!isOpen.value) {
    return
  }

  closeAndRestoreFocus()
}

watch(openPopover, (current) => {
  if (current !== 'models' && isOpen.value) {
    close()
  }
})

watch(isPopoverLayout, () => {
  close()
})

function onSelect({ modelId, gatewayId }: {
  modelId: string
  gatewayId: GatewayId | null
}) {
  selection.value = gatewayId
    ? { source: 'gateway', gatewayId, modelId }
    : { source: 'provider', modelId }
  requestPersistence()
  closeAndRestoreFocus()
}

function onClose({ restoreFocus }: { restoreFocus: boolean }) {
  if (restoreFocus) {
    closeAndRestoreFocus()

    return
  }

  close()
}

onClickOutside(root, () => {
  if (!isOpen.value || !isPopoverLayout.value) {
    return
  }

  close()
})
</script>
