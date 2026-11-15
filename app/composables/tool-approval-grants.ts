import { parseError } from 'evlog'
import type {
  ToolApprovalGrantItem,
} from '#shared/types/tool-approval-grants.d'

interface LoadedGrants {
  slug: string
  grants: ToolApprovalGrantItem[]
}

/**
 * The approvals the user gave that apply in the chat on the route ("Allow
 * in this chat" and "Always allow"), with the actions that take them back.
 * Loads lazily on the client, only on an owned chat page with the
 * `tool-approvals` flag on. `grants` stays empty until the response belongs
 * to the chat on the route, so chat A's grants never show while chat B
 * loads.
 */
export function useChatToolApprovalGrants() {
  const { routeSlug, isOwnedChatPage } = useChatRoute()
  const toolApprovalsFeature = useFeature('tool-approvals')
  const busyKey = shallowRef<string>('')

  const isEnabled = computed<boolean>(() => {
    return isOwnedChatPage.value && toolApprovalsFeature.value.active
  })

  const key = computed<string>(() => {
    return isEnabled.value
      ? `chat-tool-approval-grants:${routeSlug.value}`
      : 'chat-tool-approval-grants:none'
  })

  const asyncData = useLazyAsyncData<LoadedGrants | null>(
    key,
    async () => {
      if (!isEnabled.value) {
        return null
      }

      const slug = routeSlug.value
      const response = await $fetch(`/api/v1/chats/${slug}/tool-approvals`)

      return { slug, grants: response.grants }
    },
    {
      server: false,
      dedupe: 'defer',
      default: () => null,
    },
  )

  const grants = computed<ToolApprovalGrantItem[]>(() => {
    const value = asyncData.data.value

    return value && value.slug === routeSlug.value ? value.grants : []
  })

  const hasChatGrants = computed<boolean>(() => {
    return grants.value.some(grant => grant.scope === 'chat')
  })

  function refresh() {
    if (!isEnabled.value) {
      return Promise.resolve()
    }

    return asyncData.refresh({ dedupe: 'cancel' })
  }

  async function runAction(actionKey: string, action: () => Promise<void>) {
    if (busyKey.value) {
      return
    }

    busyKey.value = actionKey

    try {
      await action()
      await refresh()
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Could not change the approvals',
        parsedException.why,
      )
    } finally {
      busyKey.value = ''
    }
  }

  function resetChatGrants() {
    const slug = routeSlug.value

    return runAction('reset', async () => {
      await $fetch(`/api/v1/chats/${slug}/tool-approvals/reset`, {
        method: 'POST',
      })
    })
  }

  function revokeAlwaysGrant(grant: ToolApprovalGrantItem) {
    const slug = routeSlug.value

    return runAction(grantKeyOf(grant), async () => {
      await $fetch(`/api/v1/chats/${slug}/tool-approvals/revoke`, {
        method: 'POST',
        body: { connectorId: grant.connectorId, toolName: grant.toolName },
      })
    })
  }

  return {
    grants,
    hasChatGrants,
    isEnabled,
    busyKey,
    error: asyncData.error,
    refresh,
    resetChatGrants,
    revokeAlwaysGrant,
  }
}

export function grantKeyOf(grant: ToolApprovalGrantItem): string {
  return `${grant.scope}:${grant.connectorId}:${grant.toolName}`
}
