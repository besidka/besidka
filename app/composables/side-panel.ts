import type { Component } from 'vue'

export type SidePanelMode = 'detail' | 'context'

export type SidePanelLayout = 'docked' | 'overlay' | 'sheet'

export interface SidePanelView {
  viewKey: string
  title: string
  mode?: SidePanelMode
  component?: Component
  toolbar?: Component
  headerActions?: Component
  props?: Record<string, unknown>
}

export const SIDE_PANEL_WIDTH_STORAGE_KEY = 'besidka:side-panel-width'
export const SIDE_PANEL_DEFAULT_WIDTH = 480
export const SIDE_PANEL_MIN_WIDTH = 360
export const SIDE_PANEL_ABSOLUTE_MAX_WIDTH = 2400
export const SIDE_PANEL_MAX_VIEWPORT_RATIO = 0.6
export const SIDE_PANEL_MIN_CHAT_WIDTH = 768
export const SIDE_PANEL_DOCK_MIN_VIEWPORT
  = SIDE_PANEL_MIN_WIDTH + SIDE_PANEL_MIN_CHAT_WIDTH
export const SIDE_PANEL_KEYBOARD_STEP = 24
export const SIDE_PANEL_TRANSITION_MS = 300
export const SIDE_PANEL_WIDTH_PRESETS = [360, 480, 640] as const

export function getSidePanelMaxWidth(viewportWidth: number): number {
  const ratioLimit = Math.floor(viewportWidth * SIDE_PANEL_MAX_VIEWPORT_RATIO)
  const chatLimit = viewportWidth - SIDE_PANEL_MIN_CHAT_WIDTH

  return Math.max(SIDE_PANEL_MIN_WIDTH, Math.min(ratioLimit, chatLimit))
}

export function clampSidePanelWidth(
  width: number,
  viewportWidth: number,
): number {
  if (!Number.isFinite(width)) {
    return Math.min(
      SIDE_PANEL_DEFAULT_WIDTH,
      getSidePanelMaxWidth(viewportWidth),
    )
  }

  return Math.round(Math.min(
    Math.max(width, SIDE_PANEL_MIN_WIDTH),
    getSidePanelMaxWidth(viewportWidth),
  ))
}

export function clampStoredSidePanelWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return SIDE_PANEL_DEFAULT_WIDTH
  }

  return Math.round(Math.min(
    Math.max(width, SIDE_PANEL_MIN_WIDTH),
    SIDE_PANEL_ABSOLUTE_MAX_WIDTH,
  ))
}

/**
 * The next width preset after the current width, wrapping to the narrowest.
 * This is the single-click alternative to dragging the seam (WCAG 2.2
 * SC 2.5.7), so every preset must stay reachable at any viewport width.
 */
export function getNextSidePanelWidthPreset(
  width: number,
  viewportWidth: number,
): number {
  const presets = Array.from(new Set(SIDE_PANEL_WIDTH_PRESETS.map((preset) => {
    return clampSidePanelWidth(preset, viewportWidth)
  })))
  const next = presets.find((preset) => {
    return preset > width
  })

  return next ?? presets[0] ?? SIDE_PANEL_MIN_WIDTH
}

function readStoredWidth(): number | null {
  const stored = usePreferenceStorage().getItem(SIDE_PANEL_WIDTH_STORAGE_KEY)

  if (stored === null) {
    return null
  }

  const parsed = Number.parseInt(stored, 10)

  return Number.isFinite(parsed) ? parsed : null
}

export function useSidePanel() {
  const stack = useState<SidePanelView[]>('side-panel:stack', () => [])
  const isFullWidth = useState<boolean>('side-panel:full-width', () => false)
  const preferredWidth = useState<number | null>(
    'side-panel:preferred-width',
    () => null,
  )

  const currentView = computed<SidePanelView | null>(() => {
    return stack.value.at(-1) ?? null
  })

  const isOpen = computed<boolean>(() => {
    return stack.value.length > 0
  })

  const mode = computed<SidePanelMode | null>(() => {
    if (!currentView.value) {
      return null
    }

    return currentView.value.mode ?? 'detail'
  })

  const title = computed<string>(() => {
    return currentView.value?.title ?? ''
  })

  const viewKey = computed<string | null>(() => {
    return currentView.value?.viewKey ?? null
  })

  const canGoBack = computed<boolean>(() => {
    return stack.value.length > 1
  })

  const width = computed<number>(() => {
    if (preferredWidth.value !== null) {
      return preferredWidth.value
    }

    if (!import.meta.client) {
      return SIDE_PANEL_DEFAULT_WIDTH
    }

    return readStoredWidth() ?? SIDE_PANEL_DEFAULT_WIDTH
  })

  function toStackEntry(view: SidePanelView): SidePanelView {
    return {
      ...view,
      component: view.component ? markRaw(view.component) : undefined,
      toolbar: view.toolbar ? markRaw(view.toolbar) : undefined,
      headerActions: view.headerActions
        ? markRaw(view.headerActions)
        : undefined,
    }
  }

  function open(view: SidePanelView): void {
    stack.value = [toStackEntry(view)]
  }

  function push(view: SidePanelView): void {
    const current = currentView.value

    if (current?.viewKey === view.viewKey) {
      stack.value = [...stack.value.slice(0, -1), toStackEntry(view)]

      return
    }

    stack.value = [...stack.value, toStackEntry(view)]
  }

  function back(): void {
    if (stack.value.length <= 1) {
      close()

      return
    }

    stack.value = stack.value.slice(0, -1)
  }

  function close(): void {
    stack.value = []
    isFullWidth.value = false
  }

  function toggle(view: SidePanelView): void {
    if (currentView.value?.viewKey === view.viewKey) {
      close()

      return
    }

    open(view)
  }

  function toggleFullWidth(): void {
    isFullWidth.value = !isFullWidth.value
  }

  /**
   * Remembers the width the user chose, bounded only by the absolute limits.
   * The per-viewport limit is applied when the width is rendered, so a width
   * chosen on a wide screen survives a visit on a narrow one.
   */
  function setWidth(value: number, options: { persist?: boolean } = {}) {
    const stored = clampStoredSidePanelWidth(value)

    preferredWidth.value = stored

    if (options.persist) {
      persistWidth(stored)
    }

    return stored
  }

  function persistWidth(value: number = width.value): void {
    usePreferenceStorage().setItem(
      SIDE_PANEL_WIDTH_STORAGE_KEY,
      String(Math.round(value)),
    )
    requestPersistence()
  }

  return {
    stack,
    currentView,
    isOpen,
    mode,
    title,
    viewKey,
    canGoBack,
    isFullWidth,
    width,
    open,
    push,
    back,
    close,
    toggle,
    toggleFullWidth,
    setWidth,
    persistWidth,
  }
}

/**
 * Docks only when the chat column keeps at least the md width after the
 * narrowest panel, which is the same as the clamped panel width leaving
 * `SIDE_PANEL_MIN_CHAT_WIDTH`. Below that the chat would render its desktop
 * layout in a mobile-width column, so the panel overlays instead.
 */
export function useSidePanelLayout() {
  const canDock = useMediaQuery(
    `(min-width: ${SIDE_PANEL_DOCK_MIN_VIEWPORT}px)`,
  )
  const isMedium = useMediaQuery('(min-width: 48rem)')

  return computed<SidePanelLayout>(() => {
    if (canDock.value) {
      return 'docked'
    }

    return isMedium.value ? 'overlay' : 'sheet'
  })
}
