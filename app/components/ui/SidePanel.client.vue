<template>
  <template v-if="layout !== 'sheet'">
    <Transition
      enter-active-class="motion-safe:transition-opacity motion-safe:duration-200"
      leave-active-class="motion-safe:transition-opacity motion-safe:duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isOpen && layout === 'overlay'"
        class="fixed inset-0 z-[60] bg-black/40"
        aria-hidden="true"
        data-testid="side-panel-scrim"
        @click="close"
      />
    </Transition>
    <Transition
      enter-active-class="motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out"
      leave-active-class="motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-in"
      enter-from-class="translate-x-full"
      leave-to-class="translate-x-full"
      @after-leave="onPanelAfterLeave"
    >
      <aside
        v-if="isOpen"
        :id="panelId"
        ref="panel"
        tabindex="-1"
        :role="isFocusTrapped ? 'dialog' : undefined"
        :aria-modal="isFocusTrapped ? 'true' : undefined"
        :aria-label="ariaLabel || title || 'Side panel'"
        :data-layout="layout"
        :data-full-width="isDockedFullWidth ? 'true' : undefined"
        data-testid="side-panel"
        class="js-side-panel fixed top-0 bottom-0 right-0 flex flex-col bg-base-100 border-l border-base-300 shadow-xl outline-none pt-[var(--sat)]"
        :class="{
          'z-50': layout === 'docked',
          'z-[60] w-[70vw]': layout === 'overlay',
          'left-0 pr-20': isDockedFullWidth,
        }"
        :style="panelStyle"
        @keydown="onPanelKeydown"
      >
        <div
          v-if="isDockedResizable"
          role="separator"
          tabindex="0"
          aria-orientation="vertical"
          aria-label="Resize panel"
          :aria-controls="panelId"
          :aria-valuenow="effectiveWidth"
          :aria-valuemin="SIDE_PANEL_MIN_WIDTH"
          :aria-valuemax="maxWidth"
          data-testid="side-panel-separator"
          class="absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none outline-none group/seam"
          @pointerdown="onSeamPointerDown"
          @pointermove="onSeamPointerMove"
          @pointerup="onSeamPointerUp"
          @pointercancel="onSeamPointerUp"
          @lostpointercapture="onSeamPointerUp"
          @keydown="onSeamKeydown"
        >
          <span
            class="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors duration-150 group-hover/seam:bg-base-content/20 group-focus-visible/seam:bg-accent"
            :class="{ 'bg-accent': isResizing }"
          />
        </div>
        <header
          class="shrink-0 border-b border-base-300 py-2 pr-3"
          :class="isDockedResizable ? 'pl-10' : 'pl-3'"
        >
          <UiSidePanelHeader
            :title="title"
            :heading-id="headingId"
            :can-go-back="canGoBack"
            :can-resize="isDockedResizable"
            :can-expand="layout === 'docked'"
            :is-full-width="isRenderedFullWidth"
            :width-preset-label="widthPresetLabel"
            @back="back"
            @cycle-width="cycleWidthPreset"
            @toggle-full-width="toggleFullWidth"
            @close="close"
          >
            <template
              v-if="$slots['header']"
              #header
            >
              <slot name="header" />
            </template>
            <template #header-actions>
              <slot name="header-actions">
                <component
                  :is="currentView.headerActions"
                  v-if="currentView?.headerActions"
                  v-bind="currentView.props ?? {}"
                />
              </slot>
            </template>
          </UiSidePanelHeader>
        </header>
        <div
          v-if="$slots.toolbar || currentView?.toolbar"
          class="shrink-0 border-b border-base-300 py-2 pr-3"
          :class="isDockedResizable ? 'pl-10' : 'pl-3'"
        >
          <slot name="toolbar">
            <component
              :is="currentView?.toolbar"
              v-bind="currentView?.props ?? {}"
            />
          </slot>
        </div>
        <div
          ref="body"
          class="js-side-panel-body flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[max(1rem,var(--sab))]"
          :class="isDockedResizable ? 'pl-10 pr-4' : 'px-4'"
          :style="bodyFadeStyle"
          data-testid="side-panel-body"
        >
          <slot>
            <component
              :is="currentView.component"
              v-if="currentView?.component"
              :key="currentView.viewKey"
              v-bind="currentView.props ?? {}"
            />
          </slot>
        </div>
      </aside>
    </Transition>
  </template>
  <dialog
    v-else
    :id="panelId"
    ref="sheet"
    class="js-side-panel-sheet modal modal-bottom"
    :aria-labelledby="headingId"
    data-testid="side-panel-sheet"
    @cancel.prevent="close"
    @close="close"
  >
    <div
      v-if="isOpen"
      ref="sheetBox"
      tabindex="-1"
      class="modal-box flex flex-col w-full max-w-none h-[100dvh] max-h-[100dvh] p-0 pt-[var(--sat)] rounded-none outline-none"
      :class="{ 'transition-transform duration-200 ease-out': !isSwiping }"
      :style="sheetBoxStyle"
      data-testid="side-panel"
      data-layout="sheet"
    >
      <div
        class="shrink-0 px-3 pt-2 pb-1 touch-none select-none"
        data-testid="side-panel-swipe-area"
        @pointerdown="onSwipeStart"
        @pointermove="onSwipeMove"
        @pointerup="onSwipeEnd"
        @pointercancel="onSwipeCancel"
      >
        <div class="w-9 h-1 mx-auto mb-2 rounded-full bg-base-300" />
        <UiSidePanelHeader
          :title="title"
          :heading-id="headingId"
          :can-go-back="canGoBack"
          :can-resize="false"
          :can-expand="false"
          :is-full-width="false"
          :width-preset-label="widthPresetLabel"
          @back="back"
          @close="close"
        >
          <template
            v-if="$slots['header']"
            #header
          >
            <slot name="header" />
          </template>
          <template #header-actions>
            <slot name="header-actions">
              <component
                :is="currentView.headerActions"
                v-if="currentView?.headerActions"
                v-bind="currentView.props ?? {}"
              />
            </slot>
          </template>
        </UiSidePanelHeader>
      </div>
      <div
        v-if="$slots.toolbar || currentView?.toolbar"
        class="shrink-0 border-b border-base-300 px-3 pb-2"
      >
        <slot name="toolbar">
          <component
            :is="currentView?.toolbar"
            v-bind="currentView?.props ?? {}"
          />
        </slot>
      </div>
      <div
        ref="sheetBody"
        class="js-side-panel-body flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sheet-safe-padding"
        :style="sheetFadeStyle"
        data-testid="side-panel-body"
      >
        <slot>
          <component
            :is="currentView.component"
            v-if="currentView?.component"
            :key="currentView.viewKey"
            v-bind="currentView.props ?? {}"
          />
        </slot>
      </div>
    </div>
    <form
      method="dialog"
      class="modal-backdrop"
    >
      <button
        type="button"
        aria-label="Close panel"
        @click="close"
      >
        close
      </button>
    </form>
  </dialog>
</template>

<script setup lang="ts">
import type { StyleValue } from 'vue'
import type { SidePanelView } from '~/composables/side-panel'
import {
  SIDE_PANEL_KEYBOARD_STEP,
  SIDE_PANEL_MIN_WIDTH,
  SIDE_PANEL_TRANSITION_MS,
  clampSidePanelWidth,
  getNextSidePanelWidthPreset,
  getSidePanelMaxWidth,
} from '~/composables/side-panel'
import {
  captureScrollAnchor,
  holdScrollAnchor,
  restoreScrollAnchor,
} from '~/utils/scroll-anchor'

defineProps<{
  ariaLabel?: string
}>()

const SCROLL_HOLD_EXTRA_MS = 20
const SWIPE_CLOSE_DISTANCE_PX = 80
const SWIPE_CLOSE_VELOCITY = 0.5
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const {
  currentView: activeView,
  isOpen,
  canGoBack,
  isFullWidth,
  width,
  back,
  close,
  toggleFullWidth,
  setWidth,
  persistWidth,
} = useSidePanel()
const layout = useSidePanelLayout()
const route = useRoute()
const { width: viewportWidth } = useWindowSize()
const reducedMotion = usePreferredReducedMotion()

const panelId = useId()
const headingId = useId()
const panel = useTemplateRef<HTMLElement>('panel')
const body = useTemplateRef<HTMLElement>('body')
const sheet = useTemplateRef<HTMLDialogElement>('sheet')
const sheetBox = useTemplateRef<HTMLElement>('sheetBox')
const sheetBody = useTemplateRef<HTMLElement>('sheetBody')

const isResizing = shallowRef<boolean>(false)
const isSwiping = shallowRef<boolean>(false)
const swipeOffset = shallowRef<number>(0)
const opener = shallowRef<HTMLElement | null>(null)
const currentView = shallowRef<SidePanelView | null>(activeView.value)
const isRenderedFullWidth = shallowRef<boolean>(isFullWidth.value)

let swipeStartY = 0
let swipeStartTime = 0
let resizeFrameId = 0
let pendingResizeClientX: number | null = null
let resizeStartWidth = 0
let releaseScrollHold: () => void = () => {}

const title = computed<string>(() => {
  return currentView.value?.title ?? ''
})

watch([activeView, isFullWidth], ([view, fullWidth]) => {
  if (!view) {
    return
  }

  currentView.value = view
  isRenderedFullWidth.value = fullWidth
})

function onPanelAfterLeave() {
  if (!isOpen.value) {
    currentView.value = null
    isRenderedFullWidth.value = false
  }
}

const { fadeStyle: bodyFadeStyle } = useScrollEdgeFade(body)
const { fadeStyle: sheetFadeStyle } = useScrollEdgeFade(sheetBody)

const maxWidth = computed<number>(() => {
  return getSidePanelMaxWidth(viewportWidth.value)
})

const effectiveWidth = computed<number>(() => {
  return clampSidePanelWidth(width.value, viewportWidth.value)
})

const dockedInset = computed<number>(() => {
  return isOpen.value && layout.value === 'docked' ? effectiveWidth.value : 0
})

const isDockedFullWidth = computed<boolean>(() => {
  return layout.value === 'docked' && isRenderedFullWidth.value
})

const isDockedResizable = computed<boolean>(() => {
  return layout.value === 'docked' && !isRenderedFullWidth.value
})

const isFocusTrapped = computed<boolean>(() => {
  if (!isOpen.value) {
    return false
  }

  return layout.value === 'overlay'
    || (layout.value === 'docked' && isFullWidth.value)
})

const widthPresetLabel = computed<string>(() => {
  return `Panel width ${effectiveWidth.value}px, click to change`
})

const panelStyle = computed<StyleValue>(() => {
  if (!isDockedResizable.value) {
    return {}
  }

  return { width: `${effectiveWidth.value}px` }
})

const sheetBoxStyle = computed<StyleValue>(() => {
  if (!swipeOffset.value) {
    return {}
  }

  return { transform: `translateY(${swipeOffset.value}px)` }
})

function setRootInset(value: number) {
  document.documentElement.style.setProperty(
    '--side-panel-width',
    `${value}px`,
  )
}

watch(dockedInset, (inset) => {
  releaseScrollHold()

  const anchor = captureScrollAnchor()

  setRootInset(inset)

  if (isResizing.value || reducedMotion.value === 'reduce') {
    requestAnimationFrame(() => {
      restoreScrollAnchor(anchor)
    })

    return
  }

  releaseScrollHold = holdScrollAnchor(
    anchor,
    SIDE_PANEL_TRANSITION_MS + SCROLL_HOLD_EXTRA_MS,
  )
}, { immediate: true })

function stopResizing() {
  isResizing.value = false
  pendingResizeClientX = null
  cancelAnimationFrame(resizeFrameId)
  document.documentElement.classList.remove('side-panel-resizing')
}

function isFocusInsidePanelOrLost(): boolean {
  const active = document.activeElement

  if (!active || active === document.body) {
    return true
  }

  return !!active.closest('.js-side-panel, .js-side-panel-sheet')
}

watch(isOpen, async (open) => {
  if (open) {
    const active = document.activeElement

    opener.value = active instanceof HTMLElement ? active : null

    await nextTick()
    focusPanel()

    return
  }

  stopResizing()

  if (opener.value?.isConnected && isFocusInsidePanelOrLost()) {
    opener.value.focus({ preventScroll: true })
  }

  opener.value = null
}, { flush: 'post' })

watch(layout, (current, previous) => {
  stopResizing()

  if (previous === 'docked' && current !== 'docked' && isFullWidth.value) {
    toggleFullWidth()
  }
})

watch(isFocusTrapped, (trapped) => {
  const content = document.querySelector<HTMLElement>('.side-panel-inset')

  if (!content) {
    return
  }

  content.inert = trapped
})

watch([isOpen, layout], async () => {
  await nextTick()

  const dialog = sheet.value
  const shouldShowSheet = isOpen.value && layout.value === 'sheet'

  if (!dialog) {
    return
  }

  if (shouldShowSheet && !dialog.open) {
    swipeOffset.value = 0
    dialog.showModal()
    await nextTick()
    sheetBox.value?.focus({ preventScroll: true })

    return
  }

  if (!shouldShowSheet && dialog.open) {
    dialog.close()
  }
}, { flush: 'post', immediate: true })

watch(() => route.path, (_path, previousPath) => {
  if (previousPath === '/chats/new') {
    return
  }

  close()
})

watch(isFocusTrapped, async (trapped) => {
  if (!trapped) {
    return
  }

  await nextTick()

  if (!panel.value?.contains(document.activeElement)) {
    focusPanel()
  }
}, { flush: 'post' })

function focusPanel() {
  if (layout.value === 'sheet') {
    return
  }

  panel.value?.focus({ preventScroll: true })
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => {
    if (element.hidden || element.closest('[inert], fieldset[disabled]')) {
      return false
    }

    return typeof element.checkVisibility === 'function'
      ? element.checkVisibility()
      : true
  })
}

function onPanelKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !isFocusTrapped.value || !panel.value) {
    return
  }

  const focusable = getFocusableElements(panel.value)
  const first = focusable[0]
  const last = focusable.at(-1)

  if (!first || !last) {
    event.preventDefault()
    panel.value.focus({ preventScroll: true })

    return
  }

  const active = document.activeElement

  if (event.shiftKey && (active === first || active === panel.value)) {
    event.preventDefault()
    last.focus()

    return
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

function hasOtherOpenDialog(): boolean {
  return Array.from(document.querySelectorAll('dialog[open]')).some(
    (dialog) => {
      return dialog !== sheet.value
    },
  )
}

useEventListener(document, 'keydown', (event: KeyboardEvent) => {
  if (
    event.key !== 'Escape'
    || event.defaultPrevented
    || event.isComposing
    || !isOpen.value
    || layout.value === 'sheet'
    || hasOtherOpenDialog()
  ) {
    return
  }

  if (!isFocusTrapped.value && !panel.value?.contains(document.activeElement)) {
    return
  }

  if (layout.value === 'docked' && isFullWidth.value) {
    toggleFullWidth()

    return
  }

  close()
})

function onSeamPointerDown(event: PointerEvent) {
  if (event.button !== 0) {
    return
  }

  const seam = event.currentTarget as HTMLElement

  event.preventDefault()
  seam.setPointerCapture(event.pointerId)
  resizeStartWidth = effectiveWidth.value
  isResizing.value = true
  document.documentElement.classList.add('side-panel-resizing')
}

function onSeamPointerMove(event: PointerEvent) {
  if (!isResizing.value) {
    return
  }

  const shouldSchedule = pendingResizeClientX === null

  pendingResizeClientX = event.clientX

  if (!shouldSchedule) {
    return
  }

  resizeFrameId = requestAnimationFrame(() => {
    if (pendingResizeClientX === null) {
      return
    }

    setWidth(viewportWidth.value - pendingResizeClientX)
    pendingResizeClientX = null
  })
}

function onSeamPointerUp(event: PointerEvent) {
  if (!isResizing.value) {
    return
  }

  const target = event.currentTarget as HTMLElement

  if (target.hasPointerCapture(event.pointerId)) {
    target.releasePointerCapture(event.pointerId)
  }

  if (pendingResizeClientX !== null) {
    setWidth(viewportWidth.value - pendingResizeClientX)
  }

  stopResizing()

  if (effectiveWidth.value !== resizeStartWidth) {
    persistWidth(effectiveWidth.value)
  }
}

function onSeamKeydown(event: KeyboardEvent) {
  const nextWidth = getKeyboardWidth(event.key)

  if (nextWidth === null) {
    return
  }

  event.preventDefault()
  setWidth(nextWidth, { persist: true })
}

function getKeyboardWidth(key: string): number | null {
  if (key === 'ArrowLeft') {
    return effectiveWidth.value + SIDE_PANEL_KEYBOARD_STEP
  }

  if (key === 'ArrowRight') {
    return effectiveWidth.value - SIDE_PANEL_KEYBOARD_STEP
  }

  if (key === 'Home') {
    return SIDE_PANEL_MIN_WIDTH
  }

  if (key === 'End') {
    return maxWidth.value
  }

  return null
}

function cycleWidthPreset() {
  setWidth(
    getNextSidePanelWidthPreset(effectiveWidth.value, viewportWidth.value),
    { persist: true },
  )
}

function onSwipeStart(event: PointerEvent) {
  const target = event.target as HTMLElement | null

  if (event.button !== 0 || target?.closest('button, a, select, input')) {
    return
  }

  const swipeArea = event.currentTarget as HTMLElement

  swipeStartY = event.clientY
  swipeStartTime = performance.now()
  isSwiping.value = true
  swipeArea.setPointerCapture(event.pointerId)
}

function onSwipeMove(event: PointerEvent) {
  if (!isSwiping.value) {
    return
  }

  swipeOffset.value = Math.max(0, event.clientY - swipeStartY)
}

function onSwipeEnd(event: PointerEvent) {
  if (!isSwiping.value) {
    return
  }

  const distance = Math.max(0, event.clientY - swipeStartY)
  const elapsed = Math.max(1, performance.now() - swipeStartTime)
  const shouldClose = distance >= SWIPE_CLOSE_DISTANCE_PX
    || (distance > 0 && distance / elapsed >= SWIPE_CLOSE_VELOCITY)

  isSwiping.value = false

  if (shouldClose) {
    close()

    return
  }

  swipeOffset.value = 0
}

function onSwipeCancel() {
  isSwiping.value = false
  swipeOffset.value = 0
}

useEventListener(window, 'blur', () => {
  if (isResizing.value) {
    stopResizing()
  }
})

onBeforeUnmount(() => {
  releaseScrollHold()
  stopResizing()
  document.documentElement.style.removeProperty('--side-panel-width')

  const content = document.querySelector<HTMLElement>('.side-panel-inset')

  if (content) {
    content.inert = false
  }
})
</script>
