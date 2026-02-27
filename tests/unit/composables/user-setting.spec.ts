import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserSetting } from '../../../app/composables/user-setting'

describe('useUserSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    const { clearUserContext } = useUserSetting()

    clearUserContext()
  })

  it('uses local storage fallback before user settings are loaded', () => {
    localStorage.setItem('settings_reasoning_expanded', 'true')

    const { reasoningExpanded } = useUserSetting()

    expect(reasoningExpanded.value).toBe(true)
  })

  it('syncs settings once for the same user and reuses cached value', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      reasoningExpanded: true,
    })

    vi.stubGlobal('$fetch', fetchMock)

    const {
      syncForUser,
      reasoningExpanded,
    } = useUserSetting()

    await syncForUser('user-1')

    const callsAfterFirstSync = fetchMock.mock.calls.length

    await syncForUser('user-1')

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstSync)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/profiles/settings',
    )
    expect(reasoningExpanded.value).toBe(true)
  })

  it('uses DB value as source of truth after authenticated sync', async () => {
    localStorage.setItem('settings_reasoning_expanded', 'true')

    const fetchMock = vi.fn().mockResolvedValue({
      reasoningExpanded: false,
    })

    vi.stubGlobal('$fetch', fetchMock)

    const {
      reasoningExpanded,
      syncForUser,
    } = useUserSetting()

    expect(reasoningExpanded.value).toBe(true)

    await syncForUser('user-1')

    expect(reasoningExpanded.value).toBe(false)
    expect(localStorage.getItem('settings_reasoning_expanded')).toBe(
      'false',
    )
  })

  it('updates local storage without API call for guests', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('$fetch', fetchMock)

    const {
      reasoningExpanded,
      setReasoningExpanded,
    } = useUserSetting()

    await setReasoningExpanded(true)

    expect(reasoningExpanded.value).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('persists setting for authenticated users', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
      })
      .mockResolvedValueOnce({
        reasoningExpanded: true,
      })

    vi.stubGlobal('$fetch', fetchMock)

    const {
      syncForUser,
      reasoningExpanded,
      setReasoningExpanded,
    } = useUserSetting()

    await syncForUser('user-1')

    const savePromise = setReasoningExpanded(true)

    expect(reasoningExpanded.value).toBe(true)
    await savePromise

    expect(reasoningExpanded.value).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/profiles/settings',
      {
        method: 'PATCH',
        body: {
          reasoningExpanded: true,
        },
      },
    )
  })

  it('persists setting when authenticated user is active before sync', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      reasoningExpanded: true,
    })

    vi.stubGlobal('$fetch', fetchMock)

    const {
      activeUserId,
      reasoningExpanded,
      setReasoningExpanded,
    } = useUserSetting()

    activeUserId.value = 'user-1'

    await setReasoningExpanded(true)

    expect(reasoningExpanded.value).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/profiles/settings',
      {
        method: 'PATCH',
        body: {
          reasoningExpanded: true,
        },
      },
    )
  })

  it('rolls back optimistic value when authenticated save fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
      })
      .mockRejectedValueOnce(new Error('Save failed'))

    vi.stubGlobal('$fetch', fetchMock)

    const {
      reasoningExpanded,
      settingsError,
      syncForUser,
      setReasoningExpanded,
    } = useUserSetting()

    await syncForUser('user-1')

    expect(reasoningExpanded.value).toBe(false)

    const savePromise = setReasoningExpanded(true)

    expect(reasoningExpanded.value).toBe(true)
    await savePromise

    expect(reasoningExpanded.value).toBe(false)
    expect(settingsError.value).not.toBeNull()
  })
})
