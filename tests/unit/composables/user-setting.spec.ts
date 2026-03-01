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
      reasoningAutoHide: true,
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
      reasoningAutoHide: true,
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
        reasoningAutoHide: true,
      })
      .mockResolvedValueOnce({
        reasoningExpanded: true,
        reasoningAutoHide: true,
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
      reasoningAutoHide: true,
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
        reasoningAutoHide: true,
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

  it('uses localStorage fallback of true for reasoningAutoHide before sync', () => {
    const { reasoningAutoHide } = useUserSetting()

    expect(reasoningAutoHide.value).toBe(true)
  })

  it('syncs reasoningAutoHide from server response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      reasoningExpanded: false,
      reasoningAutoHide: false,
    })

    vi.stubGlobal('$fetch', fetchMock)

    const { syncForUser, reasoningAutoHide } = useUserSetting()

    await syncForUser('user-1')

    expect(reasoningAutoHide.value).toBe(false)
    expect(localStorage.getItem('settings_reasoning_auto_hide')).toBe(
      'false',
    )
  })

  it('updates reasoningAutoHide without API call for guests', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('$fetch', fetchMock)

    const { reasoningAutoHide, setReasoningAutoHide } = useUserSetting()

    await setReasoningAutoHide(false)

    expect(reasoningAutoHide.value).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('persists reasoningAutoHide for authenticated users', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
      })
      .mockResolvedValueOnce({
        reasoningAutoHide: false,
      })

    vi.stubGlobal('$fetch', fetchMock)

    const {
      syncForUser,
      reasoningAutoHide,
      setReasoningAutoHide,
    } = useUserSetting()

    await syncForUser('user-1')

    const savePromise = setReasoningAutoHide(false)

    expect(reasoningAutoHide.value).toBe(false)
    await savePromise

    expect(reasoningAutoHide.value).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/profiles/settings',
      {
        method: 'PATCH',
        body: {
          reasoningAutoHide: false,
        },
      },
    )
  })

  it('rolls back optimistic reasoningAutoHide when authenticated save fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
      })
      .mockRejectedValueOnce(new Error('Save failed'))

    vi.stubGlobal('$fetch', fetchMock)

    const {
      reasoningAutoHide,
      settingsError,
      syncForUser,
      setReasoningAutoHide,
    } = useUserSetting()

    await syncForUser('user-1')

    expect(reasoningAutoHide.value).toBe(true)

    const savePromise = setReasoningAutoHide(false)

    expect(reasoningAutoHide.value).toBe(false)
    await savePromise

    expect(reasoningAutoHide.value).toBe(true)
    expect(settingsError.value).not.toBeNull()
  })

  it('defaults allowExternalLinks to false for guests', () => {
    const { allowExternalLinks } = useUserSetting()

    expect(allowExternalLinks.value).toBe(false)
  })

  it('syncs allowExternalLinks from server response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      allowExternalLinks: true,
    })

    vi.stubGlobal('$fetch', fetchMock)

    const { syncForUser, allowExternalLinks } = useUserSetting()

    await syncForUser('user-1')

    expect(allowExternalLinks.value).toBe(true)
  })

  it('does not persist allowExternalLinks for guests', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('$fetch', fetchMock)

    const { allowExternalLinks, setAllowExternalLinks } = useUserSetting()

    await setAllowExternalLinks(true)

    expect(allowExternalLinks.value).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('persists allowExternalLinks for authenticated users', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
        allowExternalLinks: false,
      })
      .mockResolvedValueOnce({
        allowExternalLinks: true,
      })

    vi.stubGlobal('$fetch', fetchMock)

    const {
      syncForUser,
      allowExternalLinks,
      setAllowExternalLinks,
    } = useUserSetting()

    await syncForUser('user-1')

    const savePromise = setAllowExternalLinks(true)

    expect(allowExternalLinks.value).toBe(true)
    await savePromise

    expect(allowExternalLinks.value).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/profiles/settings',
      {
        method: 'PATCH',
        body: {
          allowExternalLinks: true,
        },
      },
    )
  })

  it('rolls back optimistic allowExternalLinks when save fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
        allowExternalLinks: false,
      })
      .mockRejectedValueOnce(new Error('Save failed'))

    vi.stubGlobal('$fetch', fetchMock)

    const {
      allowExternalLinks,
      settingsError,
      syncForUser,
      setAllowExternalLinks,
    } = useUserSetting()

    await syncForUser('user-1')

    expect(allowExternalLinks.value).toBe(false)

    const savePromise = setAllowExternalLinks(true)

    expect(allowExternalLinks.value).toBe(true)
    await savePromise

    expect(allowExternalLinks.value).toBe(false)
    expect(settingsError.value).not.toBeNull()
  })
})
