import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserSetting } from '../../../app/composables/user-setting'

describe('useUserSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    const { resetUserSettings } = useUserSetting()

    resetUserSettings()
  })

  it('uses local storage fallback before user settings are loaded', () => {
    localStorage.setItem('settings_reasoning_expanded', 'true')

    const { reasoningExpanded } = useUserSetting()

    expect(reasoningExpanded.value).toBe(true)
  })

  it('loads settings once for the same user and caches the value', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      reasoningExpanded: true,
    })

    vi.stubGlobal('$fetch', fetchMock)

    const {
      loadUserSettings,
      reasoningExpanded,
    } = useUserSetting()

    await loadUserSettings('user-1')
    await loadUserSettings('user-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/profiles/settings')
    expect(reasoningExpanded.value).toBe(true)
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
      loadUserSettings,
      reasoningExpanded,
      setReasoningExpanded,
    } = useUserSetting()

    await loadUserSettings('user-1')
    await setReasoningExpanded(true)

    expect(reasoningExpanded.value).toBe(true)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/profiles/settings',
      {
        method: 'PATCH',
        body: {
          reasoningExpanded: true,
        },
      },
    )
  })
})
