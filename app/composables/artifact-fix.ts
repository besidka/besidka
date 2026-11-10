import type { ArtifactDetail } from '#shared/utils/artifacts'
import type { ArtifactPanelTarget } from '~/composables/artifacts'

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

/**
 * Where "Ask to fix" can put the prompt. `here` is the artifact's own chat
 * already on screen, `chat` an origin chat that exists but is not open, and
 * `none` an artifact whose chat was deleted or that a connected app created.
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

  async function queueAndNavigate(
    text: string,
    path: string,
  ): Promise<boolean> {
    prefill.queue(text)

    await navigateTo(path)

    if (await hasReachedPath(path)) {
      return true
    }

    prefill.take()

    return false
  }

  async function fixHere(text: string) {
    if (layout.value !== 'docked') {
      sidePanel.close()
      await nextTick()
    }

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

  async function startNewChat(text: string) {
    if (route.path === NEW_CHAT_PATH) {
      await nuxtApp.callHook('chat-input:prefill', text)

      return
    }

    await queueAndNavigate(text, NEW_CHAT_PATH)
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
