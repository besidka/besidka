import {
  LazyChatGoogleFileHeaderAction,
  LazyChatGoogleFilePreview,
} from '#components'
import { getGoogleFileItemId } from '#shared/utils/google-created-file'
import type { GoogleCreatedFile } from '#shared/utils/google-created-file'

export type GoogleFilePreviewTarget = Pick<
  GoogleCreatedFile,
  'toolCallId' | 'id' | 'title' | 'kind' | 'content' | 'openLink'
> & { chatSlug: string }

export function getGoogleFilePreviewViewKey(toolCallId: string): string {
  return getGoogleFileItemId(toolCallId)
}

function toSidePanelView(target: GoogleFilePreviewTarget) {
  return {
    viewKey: getGoogleFilePreviewViewKey(target.toolCallId),
    title: target.title,
    mode: 'detail' as const,
    component: LazyChatGoogleFilePreview,
    headerActions: LazyChatGoogleFileHeaderAction,
    props: {
      toolCallId: target.toolCallId,
      fileId: target.id,
      chatSlug: target.chatSlug,
      title: target.title,
      kind: target.kind,
      content: target.content,
      openLink: target.openLink,
    },
  }
}

/**
 * Opens a file that `google__drive_create_file` created in the global side
 * panel. The chat card registers its file on mount, so the context panel can
 * open the same preview by tool call id without holding the message parts.
 * Registration happens on the client only, so no file text reaches the page
 * payload.
 */
export function useGoogleFilePreview() {
  const sidePanel = useSidePanel()
  const registry = useState<
    Record<string, GoogleFilePreviewTarget | undefined>
  >(
    'google-file-previews',
    () => ({}),
  )

  function register(target: GoogleFilePreviewTarget): void {
    registry.value[target.toolCallId] = target
  }

  function unregister(toolCallId: string): void {
    registry.value[toolCallId] = undefined
  }

  function isShowing(toolCallId: string): boolean {
    return sidePanel.isOpen.value
      && sidePanel.viewKey.value === getGoogleFilePreviewViewKey(toolCallId)
  }

  function open(target: GoogleFilePreviewTarget): void {
    sidePanel.open(toSidePanelView(target))
  }

  function pushRegistered(toolCallId: string): boolean {
    const target = registry.value[toolCallId]

    if (!target) {
      return false
    }

    sidePanel.push(toSidePanelView(target))

    return true
  }

  return { register, unregister, isShowing, open, pushRegistered }
}
