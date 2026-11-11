import {
  INTERACTIVE_REQUEST_TIMEOUT_MS,
  writeClipboardText,
} from '@besidka/artifacts-protocol'
import type {
  ClipboardWriteResult,
  DisplayMode,
  HostHandlers,
} from '@besidka/artifacts-protocol'
import type { SidePanelLayout } from '~/composables/side-panel'

export type ArtifactHostActionHandlers = Required<Pick<
  HostHandlers,
  'clipboardWrite' | 'openDiagramViewer' | 'requestDisplayMode'
>>

interface PendingCopy {
  text: string
  resolve: (result: ClipboardWriteResult) => void
}

interface ArtifactHostActionsOptions {
  layout: Readonly<Ref<SidePanelLayout>>
  displayMode: Readonly<Ref<DisplayMode>>
}

const DENIED_COPY: ClipboardWriteResult = { copied: false, reason: 'denied' }

/**
 * The parent side of the artifact kit's Copy and Fullscreen buttons. A copy
 * the browser refuses for lack of a gesture (Safari) stays pending until the
 * viewer clicks the parent's own Copy button or dismisses it; nothing is
 * ever copied without that click.
 */
export function useArtifactHostActions(options: ArtifactHostActionsOptions) {
  const { isFullWidth, toggleFullWidth } = useSidePanel()

  const pendingCopy = shallowRef<PendingCopy | null>(null)
  const isViewerOpen = shallowRef<boolean>(false)
  const viewerSource = shallowRef<string>('')

  let pendingCopyTimer: ReturnType<typeof setTimeout> | null = null

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
      || !pendingCopy.value
      || isViewerOpen.value
    ) {
      return
    }

    event.preventDefault()
    dismissPendingCopy()
  }, { capture: true })

  onScopeDispose(dismissPendingCopy)

  return {
    handlers,
    pendingCopy: readonly(pendingCopy),
    isViewerOpen,
    viewerSource: readonly(viewerSource),
    confirmPendingCopy,
    dismissPendingCopy,
  }
}
