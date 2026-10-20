<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="modal p-0"
      :aria-labelledby="titleId"
      aria-modal="true"
      data-testid="mermaid-viewer"
      @close="onClose"
    >
      <div
        class="modal-box flex h-dvh max-h-none w-screen max-w-none flex-col overflow-hidden rounded-none p-3 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:rounded-box sm:p-4"
      >
        <header class="mb-3 flex shrink-0 items-center gap-3">
          <h2
            :id="titleId"
            class="min-w-0 grow truncate text-sm font-medium sm:text-base"
          >
            Diagram
          </h2>
          <ProseMermaidActionMenu
            label="Download"
            icon="lucide:download"
            test-id="mermaid-download"
            :actions="MERMAID_DOWNLOAD_ACTIONS"
            :input="menuInput"
          />
          <ProseMermaidActionMenu
            label="Copy"
            icon="lucide:copy"
            test-id="mermaid-copy"
            :actions="MERMAID_COPY_ACTIONS"
            :input="menuInput"
          />
          <form method="dialog">
            <button
              ref="closeButtonRef"
              class="btn btn-sm btn-circle btn-ghost"
              aria-label="Close diagram viewer"
              data-testid="mermaid-viewer-close"
            >
              <Icon name="lucide:x" size="18" aria-hidden="true" />
            </button>
          </form>
        </header>

        <div
          ref="themeRef"
          class="pele-theme relative min-h-0 grow overflow-hidden rounded-box bg-base-100"
          data-testid="mermaid-viewer-body"
        >
          <div
            ref="viewportRef"
            class="js-mermaid-viewport absolute inset-0 flex touch-none items-center justify-center overflow-hidden"
            data-testid="mermaid-viewer-viewport"
          >
            <div
              ref="targetRef"
              class="js-mermaid-target shrink-0"
              data-testid="mermaid-viewer-target"
              v-html="svg"
            />
          </div>
          <div
            v-if="!svg && !renderError"
            class="skeleton skeleton--default absolute inset-4"
          />
          <p
            v-if="renderError"
            class="absolute inset-x-4 top-4 text-sm text-base-content/60"
            data-testid="mermaid-viewer-error"
          >
            {{ renderError }}
          </p>
          <div
            v-if="svg"
            class="join join-vertical absolute bottom-4 right-4 [--radius-field:0.5rem] rounded-(--radius-field) shadow-lg"
          >
            <button
              type="button"
              class="btn btn-sm btn-square join-item"
              aria-label="Zoom in"
              data-testid="mermaid-zoom-in"
              @click="zoomIn"
            >
              <Icon name="lucide:plus" size="16" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="btn btn-sm btn-square join-item"
              aria-label="Zoom out"
              data-testid="mermaid-zoom-out"
              @click="zoomOut"
            >
              <Icon name="lucide:minus" size="16" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <form method="dialog" class="modal-backdrop">
        <button aria-label="Close diagram viewer">Close</button>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import Panzoom from '@panzoom/panzoom'
import type { PanzoomObject } from '@panzoom/panzoom'
import type { DiagramMenuInput } from '~/types/diagram-export.d'

const props = defineProps<{
  source: string
}>()

const RESIZE_DEBOUNCE_MS: number = 150
const FIT_SCALE_TOLERANCE: number = 0.001
const MIN_VISIBLE_SIZE: number = 48
const MIN_SCALE: number = 0.2
const MAX_SCALE: number = 8
const MAX_FIT_SCALE: number = 2
const ZOOM_STEP: number = 0.3
const FIT_PADDING: number = 16

const isOpen = defineModel<boolean>('open', { required: true })
const { renderDiagram } = useDiagramRenderer()

const dialogRef = useTemplateRef<HTMLDialogElement>('dialogRef')
const closeButtonRef = useTemplateRef<HTMLButtonElement>('closeButtonRef')
const themeRef = useTemplateRef<HTMLElement>('themeRef')
const viewportRef = useTemplateRef<HTMLElement>('viewportRef')
const targetRef = useTemplateRef<HTMLElement>('targetRef')

const titleId = useId()
const idPrefix = `mermaid-viewer-${useId()}`
const previouslyFocusedElement = shallowRef<HTMLElement | null>(null)
const isDialogVisible = shallowRef<boolean>(false)
const svg = shallowRef<string>('')
const renderError = shallowRef<string>('')

let panzoom: PanzoomObject | null = null
let wheelTarget: HTMLElement | null = null
let resizeObserver: ResizeObserver | null = null
let fittedScale: number = 1
let observedWidth: number = 0
let observedHeight: number = 0

function getThemeElement(): HTMLElement | null {
  return themeRef.value
}

const menuInput = computed<DiagramMenuInput>(() => {
  return {
    source: props.source,
    svg: svg.value,
    themeElement: getThemeElement,
  }
})

function onWheel(event: WheelEvent) {
  event.preventDefault()
  panzoom?.zoomWithWheel(event)
}

function destroyPanzoom() {
  resizeObserver?.disconnect()
  resizeObserver = null
  wheelTarget?.removeEventListener('wheel', onWheel)
  wheelTarget = null
  panzoom?.destroy()
  panzoom = null
}

function getFitScale(viewport: HTMLElement, target: HTMLElement): number {
  const availableWidth = viewport.clientWidth - FIT_PADDING * 2
  const availableHeight = viewport.clientHeight - FIT_PADDING * 2

  if (
    availableWidth <= 0
    || availableHeight <= 0
    || !target.offsetWidth
    || !target.offsetHeight
  ) {
    return 1
  }

  return Math.min(
    MAX_FIT_SCALE,
    availableWidth / target.offsetWidth,
    availableHeight / target.offsetHeight,
  )
}

function fitToViewport() {
  const viewport = viewportRef.value
  const target = targetRef.value

  if (!panzoom || !viewport || !target) {
    return
  }

  const fitScale = getFitScale(viewport, target)

  fittedScale = fitScale
  panzoom.setOptions({
    minScale: Math.min(MIN_SCALE, fitScale),
    startScale: fitScale,
    startX: 0,
    startY: 0,
  })
  panzoom.reset({ animate: false })
}

function clampPan(viewport: HTMLElement, target: HTMLElement) {
  if (!panzoom) {
    return
  }

  const scale = panzoom.getScale()
  const { x, y } = panzoom.getPan()
  const scaledWidth = target.offsetWidth * scale
  const scaledHeight = target.offsetHeight * scale
  const limitX = Math.max(
    0,
    (viewport.clientWidth + scaledWidth) / 2 - MIN_VISIBLE_SIZE,
  )
  const limitY = Math.max(
    0,
    (viewport.clientHeight + scaledHeight) / 2 - MIN_VISIBLE_SIZE,
  )
  const clampedX = Math.min(Math.max(x * scale, -limitX), limitX) / scale
  const clampedY = Math.min(Math.max(y * scale, -limitY), limitY) / scale

  if (clampedX !== x || clampedY !== y) {
    panzoom.pan(clampedX, clampedY, { animate: false })
  }
}

const refitAfterResize = useDebounceFn(() => {
  const viewport = viewportRef.value
  const target = targetRef.value

  if (!panzoom || !viewport || !target) {
    return
  }

  if (
    viewport.clientWidth === observedWidth
    && viewport.clientHeight === observedHeight
  ) {
    return
  }

  observedWidth = viewport.clientWidth
  observedHeight = viewport.clientHeight

  const isZoomedByUser
    = Math.abs(panzoom.getScale() - fittedScale) > FIT_SCALE_TOLERANCE

  if (isZoomedByUser) {
    clampPan(viewport, target)

    return
  }

  fitToViewport()
}, RESIZE_DEBOUNCE_MS)

function observeViewport(viewport: HTMLElement) {
  if (typeof ResizeObserver === 'undefined') {
    return
  }

  observedWidth = viewport.clientWidth
  observedHeight = viewport.clientHeight
  resizeObserver = new ResizeObserver(refitAfterResize)
  resizeObserver.observe(viewport)
}

function setupPanzoom() {
  destroyPanzoom()

  const viewport = viewportRef.value
  const target = targetRef.value

  if (!viewport || !target) {
    return
  }

  panzoom = Panzoom(target, {
    canvas: true,
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
    step: ZOOM_STEP,
    touchAction: 'none',
  })

  viewport.addEventListener('wheel', onWheel, { passive: false })
  wheelTarget = viewport

  fitToViewport()
  observeViewport(viewport)
}

function zoomIn() {
  panzoom?.zoomIn()
}

function zoomOut() {
  panzoom?.zoomOut()
}

watch(
  [isDialogVisible, () => props.source],
  async ([isVisible], _previous, onCleanup) => {
    if (!isVisible) {
      destroyPanzoom()
      svg.value = ''
      renderError.value = ''

      return
    }

    let isStale = false

    onCleanup(() => {
      isStale = true
    })

    renderError.value = ''

    const result = await renderDiagram(props.source, {
      idPrefix,
      maxWidth: viewportRef.value?.clientWidth || undefined,
    })

    if (isStale) {
      return
    }

    if ('error' in result) {
      renderError.value = result.error.message
      destroyPanzoom()
      svg.value = ''

      return
    }

    svg.value = result.svg

    await nextTick()

    if (isStale) {
      return
    }

    setupPanzoom()
  },
  { flush: 'post' },
)

async function restoreFocus() {
  const element = previouslyFocusedElement.value

  previouslyFocusedElement.value = null

  if (!element) {
    return
  }

  await nextTick()

  element.focus()
}

async function updateDialog(shouldOpen: boolean) {
  const dialog = dialogRef.value

  if (!dialog) {
    return
  }

  if (!shouldOpen) {
    if (dialog.open) {
      dialog.close()
    }

    isDialogVisible.value = false

    return
  }

  if (dialog.open) {
    isDialogVisible.value = true

    return
  }

  previouslyFocusedElement.value = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  dialog.showModal()
  isDialogVisible.value = true

  await nextTick()

  if (isOpen.value) {
    closeButtonRef.value?.focus()
  }
}

function onClose() {
  destroyPanzoom()
  isDialogVisible.value = false
  isOpen.value = false
  restoreFocus()
}

onBeforeUnmount(() => {
  destroyPanzoom()

  if (dialogRef.value?.open) {
    dialogRef.value.close()
  }

  isDialogVisible.value = false
  restoreFocus()
})

onMounted(async () => {
  await updateDialog(isOpen.value)
})

watch(isOpen, updateDialog, {
  flush: 'post',
})
</script>
