import {
  INTERACTIVE_REQUEST_TIMEOUT_MS,
  writeClipboardText,
} from '@besidka/artifacts-protocol'
import type {
  ClipboardWriteResult,
  DiagramExportAction,
  DiagramExportResult,
  DisplayMode,
  HostHandlers,
} from '@besidka/artifacts-protocol'
import type { SidePanelLayout } from '~/composables/side-panel'
import type { DiagramExportInput } from '~/types/diagram-export.d'

export type ArtifactHostActionHandlers = Required<Pick<
  HostHandlers,
  | 'clipboardWrite'
  | 'openDiagramViewer'
  | 'requestDisplayMode'
  | 'diagramExport'
>>

interface PendingCopy {
  text: string
  resolve: (result: ClipboardWriteResult) => void
}

export interface PendingDiagramExport {
  action: DiagramExportAction
  label: string
  input: DiagramExportInput
  resolve: (result: DiagramExportResult) => void
}

interface ArtifactHostActionsOptions {
  layout: Readonly<Ref<SidePanelLayout>>
  displayMode: Readonly<Ref<DisplayMode>>
  diagramThemeElement?: () => HTMLElement | null
}

const DIAGRAM_EXPORT_LABELS: Record<DiagramExportAction, string> = {
  'download-svg': 'Download SVG',
  'download-png': 'Download PNG',
  'download-drawio': 'Download .drawio',
  'copy-source': 'Copy code',
  'copy-markdown': 'Copy Markdown',
  'copy-svg': 'Copy SVG',
  'copy-drawio': 'Copy draw.io',
}

const NOT_EXPORTED: DiagramExportResult = { completed: false }

const COPY_ACTION_PREFIX = 'copy-'

const DENIED_COPY: ClipboardWriteResult = { copied: false, reason: 'denied' }

/**
 * The parent side of the artifact kit's Copy, Download and Fullscreen
 * buttons. A copy the browser refuses for lack of a gesture (Safari), and a
 * Mermaid export asked for without one, stay pending until the viewer
 * clicks the parent's own button or dismisses it; nothing is copied or
 * saved without that click. Mermaid exports render the source with the
 * chat's renderer and reuse its export code, themed from the parent.
 */
export function useArtifactHostActions(options: ArtifactHostActionsOptions) {
  const { isFullWidth, toggleFullWidth } = useSidePanel()

  const { renderDiagram } = useDiagramRenderer()
  const { runExportAction } = useDiagramExport()
  const pendingCopy = shallowRef<PendingCopy | null>(null)
  const pendingExport = shallowRef<PendingDiagramExport | null>(null)
  const isViewerOpen = shallowRef<boolean>(false)
  const viewerSource = shallowRef<string>('')
  const exportIdPrefix = `artifact-export-${useId()}`

  let pendingCopyTimer: ReturnType<typeof setTimeout> | null = null
  let pendingExportTimer: ReturnType<typeof setTimeout> | null = null
  let exportEpoch = 0

  function takePendingExport(): PendingDiagramExport | null {
    const pending = pendingExport.value

    if (pendingExportTimer) {
      clearTimeout(pendingExportTimer)
    }

    pendingExportTimer = null
    pendingExport.value = null

    return pending
  }

  function dismissPendingExport() {
    exportEpoch += 1
    takePendingExport()?.resolve(NOT_EXPORTED)
  }

  async function confirmPendingExport() {
    const pending = takePendingExport()

    if (!pending) {
      return
    }

    const completed = await runExportAction(pending.action, pending.input)

    pending.resolve({ completed })
  }

  function waitForParentExport(
    action: DiagramExportAction,
    input: DiagramExportInput,
  ): Promise<DiagramExportResult> {
    dismissPendingExport()

    return new Promise((resolve) => {
      pendingExport.value = {
        action,
        label: DIAGRAM_EXPORT_LABELS[action],
        input,
        resolve,
      }
      pendingExportTimer = setTimeout(
        dismissPendingExport,
        INTERACTIVE_REQUEST_TIMEOUT_MS,
      )
    })
  }

  async function prepareDiagramExport(
    source: string,
  ): Promise<DiagramExportInput | null> {
    const themeElement = options.diagramThemeElement?.()

    if (!themeElement) {
      return null
    }

    const result = await renderDiagram(source, { idPrefix: exportIdPrefix })

    if ('error' in result) {
      return null
    }

    return { source, svg: sanitizeDiagramSvg(result.svg), themeElement }
  }

  function takePendingCopy(): PendingCopy | null {
    const pending = pendingCopy.value

    if (pendingCopyTimer) {
      clearTimeout(pendingCopyTimer)
    }

    pendingCopyTimer = null
    pendingCopy.value = null

    return pending
  }

  function dismissPendingCopy() {
    takePendingCopy()?.resolve(DENIED_COPY)
  }

  async function confirmPendingCopy() {
    const pending = takePendingCopy()

    if (!pending) {
      return
    }

    pending.resolve(await writeClipboardText(pending.text))
  }

  function waitForParentCopy(text: string): Promise<ClipboardWriteResult> {
    dismissPendingCopy()

    return new Promise((resolve) => {
      pendingCopy.value = { text, resolve }
      pendingCopyTimer = setTimeout(
        dismissPendingCopy,
        INTERACTIVE_REQUEST_TIMEOUT_MS,
      )
    })
  }

  const handlers: ArtifactHostActionHandlers = {
    clipboardWrite: async ({ text }) => {
      const result = await writeClipboardText(text)

      if (result.copied || result.reason !== 'gesture-required') {
        return result
      }

      return waitForParentCopy(text)
    },
    diagramExport: async ({ source, action, userActivation }) => {
      const epoch = exportEpoch
      const input = await prepareDiagramExport(source)

      if (!input || epoch !== exportEpoch) {
        return NOT_EXPORTED
      }

      if (!userActivation) {
        return waitForParentExport(action, input)
      }

      if (await runExportAction(action, input)) {
        return { completed: true }
      }

      return action.startsWith(COPY_ACTION_PREFIX)
        ? waitForParentExport(action, input)
        : NOT_EXPORTED
    },
    openDiagramViewer: ({ source }) => {
      viewerSource.value = source
      isViewerOpen.value = true
    },
    requestDisplayMode: ({ mode }) => {
      const wantsFullWidth = mode === 'fullscreen'

      if (
        options.layout.value === 'docked'
        && wantsFullWidth !== isFullWidth.value
      ) {
        toggleFullWidth()
      }

      return { displayMode: options.displayMode.value }
    },
  }

  useEventListener(document, 'keydown', (event: KeyboardEvent) => {
    if (
      event.key !== 'Escape'
      || event.isComposing
      || (!pendingCopy.value && !pendingExport.value)
      || isViewerOpen.value
    ) {
      return
    }

    event.preventDefault()
    dismissPendingCopy()
    dismissPendingExport()
  }, { capture: true })

  onScopeDispose(() => {
    dismissPendingCopy()
    dismissPendingExport()
  })

  return {
    handlers,
    pendingCopy: readonly(pendingCopy),
    pendingExport: readonly(pendingExport),
    confirmPendingExport,
    dismissPendingExport,
    isViewerOpen,
    viewerSource: readonly(viewerSource),
    confirmPendingCopy,
    dismissPendingCopy,
  }
}
