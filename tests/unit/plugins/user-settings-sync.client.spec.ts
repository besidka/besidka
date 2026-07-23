import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import userSettingsSyncPlugin
  from '../../../app/plugins/10.user-settings-sync.client'
import { useAuth } from '../../../app/composables/auth'
import { useUserSetting } from '../../../app/composables/user-setting'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

mockNuxtImport('$fetch', () => fetchMock)

function getPluginSetup() {
  return userSettingsSyncPlugin as unknown as (
    nuxtApp: Record<string, unknown>,
  ) => unknown
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('user settings sync plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    const { clearUserContext } = useUserSetting()
    const { user } = useAuth()

    clearUserContext()
    user.value = null
  })

  it('syncs settings immediately when auth user is already available', async () => {
    fetchMock.mockResolvedValue({
      reasoningExpanded: true,
      reasoningAutoHide: true,
    })
    const { user } = useAuth()
    const { activeUserId, reasoningExpanded } = useUserSetting()

    user.value = {
      id: 'user-1',
    } as never

    await getPluginSetup()({})
    await nextTick()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/profiles/settings')
    expect(activeUserId.value).toBe('user-1')
    expect(reasoningExpanded.value).toBe(true)
  })

  it('clears user context when auth user becomes null', async () => {
    fetchMock.mockResolvedValue({
      reasoningExpanded: false,
      reasoningAutoHide: true,
    })
    const { user } = useAuth()
    const { activeUserId } = useUserSetting()

    user.value = {
      id: 'user-1',
    } as never

    await getPluginSetup()({})
    await nextTick()
    await flushPromises()

    expect(activeUserId.value).toBe('user-1')

    user.value = null
    await nextTick()
    await flushPromises()

    expect(activeUserId.value).toBeNull()
  })

  it('does not trigger sync again when user id stays unchanged', async () => {
    fetchMock.mockResolvedValue({
      reasoningExpanded: false,
      reasoningAutoHide: true,
    })
    const { user } = useAuth()

    user.value = {
      id: 'user-1',
    } as never

    await getPluginSetup()({})
    await nextTick()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    user.value = {
      id: 'user-1',
    } as never
    await nextTick()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
