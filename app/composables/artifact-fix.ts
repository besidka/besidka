import type { ArtifactDetail } from '#shared/utils/artifacts'
import type { ArtifactPanelTarget } from '~/composables/artifacts'
import type { AttachedArtifact } from '~/types/chat-input-tools'

export type ArtifactFixOrigin = 'unknown' | 'here' | 'chat' | 'none'

export const NEW_CHAT_PATH = '/chats/new'
const ROUTE_SETTLE_TIMEOUT_MS = 3000

export function getArtifactOriginChatSlug(
  detail: ArtifactDetail | null,
): string | null {
  if (!detail || detail.createdVia === 'mcp') {
    return null
  }

  return detail.originChatSlug
}

export function toAttachedArtifact(
  target: ArtifactPanelTarget,
): AttachedArtifact | null {
  if (!target.artifactId || !target.kind || !target.version) {
    return null
  }

  return {
    artifactId: target.artifactId,
    version: target.version,
    kind: target.kind,
    title: target.title,
  }
}

/**
 * Where "Ask to fix" can put the prompt. `here` is the artifact's own chat
 * already on screen, `chat` an origin chat that exists but is not open, and
 * `none` an artifact whose chat was deleted or that a connected app created:
 * a new chat opens with the artifact attached and the prompt prefilled.
 * Every path only fills the composer: nothing is sent and no model is called.
 */
export function useArtifactFix(detail: Ref<ArtifactDetail | null>) {
  const nuxtApp = useNuxtApp()
  const route = useRoute()
  const panel = useArtifactPanel()
  const sidePanel = useSidePanel()
  const layout = useSidePanelLayout()
  const prefill = useChatInputPrefill()
  const { routeSlug, isOwnedChatPage } = useChatRoute()

  const originChatSlug = computed<string | null>(() => {
    return getArtifactOriginChatSlug(detail.value)
  })

  const origin = computed<ArtifactFixOrigin>(() => {
    if (!detail.value) {
      return isOwnedChatPage.value ? 'here' : 'unknown'
    }

    if (!originChatSlug.value) {
      return 'none'
    }

    return isOwnedChatPage.value && routeSlug.value === originChatSlug.value
      ? 'here'
      : 'chat'
  })

  async function hasReachedPath(path: string): Promise<boolean> {
    try {
      await until(() => route.path).toBe(path, {
        timeout: ROUTE_SETTLE_TIMEOUT_MS,
        throwOnTimeout: true,
      })
    } catch {
      return false
    }

    await nextTick()

    return true
  }

  async function closeOverlayPanel() {
    if (layout.value === 'docked') {
      return
    }

    sidePanel.close()
    await nextTick()
  }

  async function queueAndNavigate(
    text: string,
    path: string,
    artifact: AttachedArtifact | null = null,
  ): Promise<boolean> {
    await closeOverlayPanel()
    prefill.queue(text, artifact)

    await navigateTo(path)

    if (await hasReachedPath(path)) {
      return true
    }

    prefill.take()
    prefill.takeArtifact()

    return false
  }

  async function fixHere(text: string) {
    await closeOverlayPanel()
    await nuxtApp.callHook('chat-input:prefill', text)
  }

  async function fixInOriginChat(
    text: string,
    target: ArtifactPanelTarget,
  ) {
    const path = `/chats/${originChatSlug.value}`

    const hasNavigated = await queueAndNavigate(text, path)

    if (!hasNavigated || layout.value !== 'docked') {
      return
    }

    panel.open(target, { preserveFocus: true })
  }

  async function startNewChat(text: string, target: ArtifactPanelTarget) {
    const artifact = toAttachedArtifact(target)

    if (route.path === NEW_CHAT_PATH) {
      await closeOverlayPanel()

      if (artifact) {
        await nuxtApp.callHook('chat-input:attach-artifact', artifact)
      }

      await nuxtApp.callHook('chat-input:prefill', text)

      return
    }

    await queueAndNavigate(text, NEW_CHAT_PATH, artifact)
  }

  async function askToFix(text: string, target: ArtifactPanelTarget) {
    if (origin.value === 'here') {
      await fixHere(text)

      return
    }

    if (origin.value === 'chat') {
      await fixInOriginChat(text, target)
    }
  }

  return { origin, askToFix, startNewChat }
}
