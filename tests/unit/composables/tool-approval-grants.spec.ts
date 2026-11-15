import { computed, defineComponent, h, reactive } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatToolApprovalGrants } from '../../../app/composables/tool-approval-grants'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  errorMessage: vi.fn(),
  isActive: true,
}))

const route = reactive<{ path: string, params: Record<string, string> }>({
  path: '',
  params: {},
})

mockNuxtImport('useRoute', () => () => route)
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)
mockNuxtImport('useFeature', () => {
  return () => computed(() => ({ active: mocks.isActive }))
})

const GRANTS = [
  {
    scope: 'chat',
    connectorId: 'c1',
    connectorTitle: 'Linear',
    toolName: 'update_issue',
  },
  {
    scope: 'always',
    connectorId: 'c1',
    connectorTitle: 'Linear',
    toolName: 'create_issue',
  },
]

function setRoute(path: string, slug?: string) {
  route.path = path
  route.params = slug ? { slug } : {}
}

async function mountComposable() {
  let captured: ReturnType<typeof useChatToolApprovalGrants> | null = null

  await mountSuspended(defineComponent({
    setup() {
      captured = useChatToolApprovalGrants()

      return () => h('div')
    },
  }))

  const grants = captured as unknown as ReturnType<
    typeof useChatToolApprovalGrants
  >

  await grants.refresh()
  await flushPromises()

  return grants
}

describe('useChatToolApprovalGrants', () => {
  beforeEach(() => {
    clearNuxtData()
    mocks.fetch.mockReset()
    mocks.errorMessage.mockReset()
    mocks.isActive = true
    setRoute('/chats/chat-1', 'chat-1')
  })

  it('loads the grants of the chat on the route', async () => {
    mocks.fetch.mockResolvedValue({ grants: GRANTS })

    const { grants, hasChatGrants } = await mountComposable()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/chats/chat-1/tool-approvals')
    expect(grants.value).toEqual(GRANTS)
    expect(hasChatGrants.value).toBe(true)
  })

  it('loads nothing with the tool-approvals flag off', async () => {
    mocks.isActive = false

    const { grants } = await mountComposable()

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(grants.value).toEqual([])
  })

  it('resets the chat grants and reloads', async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      return url.endsWith('/reset') ? { ok: true } : { grants: GRANTS }
    })

    const { resetChatGrants } = await mountComposable()

    await resetChatGrants()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/chats/chat-1/tool-approvals/reset',
      { method: 'POST' },
    )
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/chats/chat-1/tool-approvals',
    )
  })

  it('revokes an always grant by connector and tool', async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      return url.endsWith('/revoke') ? { ok: true } : { grants: GRANTS }
    })

    const { revokeAlwaysGrant } = await mountComposable()

    await revokeAlwaysGrant(GRANTS[1] as never)

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/chats/chat-1/tool-approvals/revoke',
      {
        method: 'POST',
        body: { connectorId: 'c1', toolName: 'create_issue' },
      },
    )
  })

  it('shows an error when an action fails', async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/reset')) {
        throw Object.assign(new Error('Too many connector requests'), {
          data: { message: 'Too many connector requests' },
        })
      }

      return { grants: GRANTS }
    })

    const { resetChatGrants, busyKey } = await mountComposable()

    await resetChatGrants()

    expect(mocks.errorMessage).toHaveBeenCalledWith(
      'Too many connector requests',
      undefined,
    )
    expect(busyKey.value).toBe('')
  })
})
