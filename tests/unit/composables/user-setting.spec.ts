import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useUserSetting } from '../../../app/composables/user-setting'

const { fetchMock, getProvidersMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  getProvidersMock: vi.fn(),
}))

mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('getProviders', () => getProvidersMock)

describe('useUserSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    getProvidersMock.mockReturnValue({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          models: [{ id: 'gpt-5.4' }],
        },
        {
          id: 'google',
          name: 'Google AI Studio',
          models: [{ id: 'gemini-2.5-flash' }],
        },
      ],
    })

    const { clearUserContext } = useUserSetting()

    clearUserContext()
  })

  it('uses local storage fallback before user settings are loaded', () => {
    localStorage.setItem('settings_reasoning_expanded', 'true')

    const { reasoningExpanded } = useUserSetting()

    expect(reasoningExpanded.value).toBe(true)
  })

  it('syncs settings once for the same user and reuses cached value', async () => {
    fetchMock.mockResolvedValue({
      reasoningExpanded: true,
      reasoningAutoHide: true,
    })
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

    fetchMock.mockResolvedValue({
      reasoningExpanded: false,
      reasoningAutoHide: true,
    })
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
    fetchMock.mockReset()
    const {
      reasoningExpanded,
      setReasoningExpanded,
    } = useUserSetting()

    await setReasoningExpanded(true)

    expect(reasoningExpanded.value).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('persists setting for authenticated users', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
      })
      .mockResolvedValueOnce({
        reasoningExpanded: true,
        reasoningAutoHide: true,
      })
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
    fetchMock.mockResolvedValue({
      reasoningExpanded: true,
      reasoningAutoHide: true,
    })
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
    fetchMock.mockReset()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
      })
      .mockRejectedValueOnce(new Error('Save failed'))
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
    fetchMock.mockResolvedValue({
      reasoningExpanded: false,
      reasoningAutoHide: false,
    })
    const { syncForUser, reasoningAutoHide } = useUserSetting()

    await syncForUser('user-1')

    expect(reasoningAutoHide.value).toBe(false)
    expect(localStorage.getItem('settings_reasoning_auto_hide')).toBe(
      'false',
    )
  })

  it('updates reasoningAutoHide without API call for guests', async () => {
    fetchMock.mockReset()
    const { reasoningAutoHide, setReasoningAutoHide } = useUserSetting()

    await setReasoningAutoHide(false)

    expect(reasoningAutoHide.value).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('persists reasoningAutoHide for authenticated users', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
      })
      .mockResolvedValueOnce({
        reasoningAutoHide: false,
      })
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
    fetchMock.mockReset()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
      })
      .mockRejectedValueOnce(new Error('Save failed'))
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
    fetchMock.mockResolvedValue({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      allowExternalLinks: true,
    })
    const { syncForUser, allowExternalLinks } = useUserSetting()

    await syncForUser('user-1')

    expect(allowExternalLinks.value).toBe(true)
  })

  it('does not persist allowExternalLinks for guests', async () => {
    fetchMock.mockReset()
    const { allowExternalLinks, setAllowExternalLinks } = useUserSetting()

    await setAllowExternalLinks(true)

    expect(allowExternalLinks.value).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('persists allowExternalLinks for authenticated users', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
        allowExternalLinks: false,
      })
      .mockResolvedValueOnce({
        allowExternalLinks: true,
      })
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
    fetchMock.mockReset()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
        allowExternalLinks: false,
      })
      .mockRejectedValueOnce(new Error('Save failed'))
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

  it('defaults notificationPromptState to null for guests', () => {
    const { notificationPromptState } = useUserSetting()

    expect(notificationPromptState.value).toBeNull()
  })

  it('syncs notificationPromptState from server response', async () => {
    fetchMock.mockResolvedValue({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      notificationPromptState: false,
    })
    const { syncForUser, notificationPromptState } = useUserSetting()

    await syncForUser('user-1')

    expect(notificationPromptState.value).toBe(false)
  })

  it('does not persist notificationPromptState for guests', async () => {
    fetchMock.mockReset()
    const {
      notificationPromptState,
      setNotificationPromptState,
    } = useUserSetting()

    await setNotificationPromptState(true)

    expect(notificationPromptState.value).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('persists notificationPromptState for authenticated users', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
        notificationPromptState: null,
      })
      .mockResolvedValueOnce({
        notificationPromptState: true,
      })
    const {
      syncForUser,
      notificationPromptState,
      setNotificationPromptState,
    } = useUserSetting()

    await syncForUser('user-1')

    const savePromise = setNotificationPromptState(true)

    expect(notificationPromptState.value).toBe(true)
    await savePromise

    expect(notificationPromptState.value).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/profiles/settings',
      {
        method: 'PATCH',
        body: {
          notificationPromptState: true,
        },
      },
    )
  })

  it('rolls back optimistic notificationPromptState when save fails', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
        notificationPromptState: null,
      })
      .mockRejectedValueOnce(new Error('Save failed'))
    const {
      notificationPromptState,
      settingsError,
      syncForUser,
      setNotificationPromptState,
    } = useUserSetting()

    await syncForUser('user-1')

    expect(notificationPromptState.value).toBeNull()

    const savePromise = setNotificationPromptState(false)

    expect(notificationPromptState.value).toBe(false)
    await savePromise

    expect(notificationPromptState.value).toBeNull()
    expect(settingsError.value).not.toBeNull()
  })

  it('uses local storage fallback of false for sidebarPinned before sync', () => {
    localStorage.setItem('settings_sidebar_pinned', 'true')

    const { sidebarPinned } = useUserSetting()

    expect(sidebarPinned.value).toBe(true)
  })

  it('uses DB value as source of truth for sidebarPinned after sync', async () => {
    localStorage.setItem('settings_sidebar_pinned', 'true')

    fetchMock.mockResolvedValue({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      sidebarPinned: false,
    })
    const {
      sidebarPinned,
      syncForUser,
    } = useUserSetting()

    expect(sidebarPinned.value).toBe(true)

    await syncForUser('user-1')

    expect(sidebarPinned.value).toBe(false)
    expect(localStorage.getItem('settings_sidebar_pinned')).toBe(
      'false',
    )
  })

  it('updates local storage without API call for sidebarPinned guests', async () => {
    fetchMock.mockReset()
    const {
      sidebarPinned,
      setSidebarPinned,
    } = useUserSetting()

    await setSidebarPinned(true)

    expect(sidebarPinned.value).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('persists sidebarPinned for authenticated users', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
        sidebarPinned: false,
      })
      .mockResolvedValueOnce({
        sidebarPinned: true,
      })
    const {
      syncForUser,
      sidebarPinned,
      setSidebarPinned,
    } = useUserSetting()

    await syncForUser('user-1')

    const savePromise = setSidebarPinned(true)

    expect(sidebarPinned.value).toBe(true)
    await savePromise

    expect(sidebarPinned.value).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/profiles/settings',
      {
        method: 'PATCH',
        body: {
          sidebarPinned: true,
        },
      },
    )
  })

  it('persists sidebarPinned when authenticated user is active before sync', async () => {
    fetchMock.mockResolvedValue({
      sidebarPinned: true,
    })
    const {
      activeUserId,
      sidebarPinned,
      setSidebarPinned,
    } = useUserSetting()

    activeUserId.value = 'user-1'

    await setSidebarPinned(true)

    expect(sidebarPinned.value).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/profiles/settings',
      {
        method: 'PATCH',
        body: {
          sidebarPinned: true,
        },
      },
    )
  })

  it('rolls back optimistic sidebarPinned when authenticated save fails', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
        sidebarPinned: false,
      })
      .mockRejectedValueOnce(new Error('Save failed'))
    const {
      sidebarPinned,
      settingsError,
      syncForUser,
      setSidebarPinned,
    } = useUserSetting()

    await syncForUser('user-1')

    expect(sidebarPinned.value).toBe(false)

    const savePromise = setSidebarPinned(true)

    expect(sidebarPinned.value).toBe(true)
    await savePromise

    expect(sidebarPinned.value).toBe(false)
    expect(settingsError.value).not.toBeNull()
  })

  it('uses the local storage fallback for favoriteModels before sync', () => {
    localStorage.setItem(
      'settings_favorite_models',
      JSON.stringify(['gpt-5.4']),
    )

    const { favoriteModels } = useUserSetting()

    expect(favoriteModels.value).toEqual(['gpt-5.4'])
  })

  it('falls back to an empty list when stored favorites are corrupt', () => {
    localStorage.setItem('settings_favorite_models', 'not json')

    const { favoriteModels } = useUserSetting()

    expect(favoriteModels.value).toEqual([])
  })

  it('uses DB favoriteModels as source of truth after sync', async () => {
    localStorage.setItem(
      'settings_favorite_models',
      JSON.stringify(['gpt-5.4']),
    )

    fetchMock.mockResolvedValue({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      favoriteModels: ['gemini-2.5-flash'],
    })
    const {
      favoriteModels,
      syncForUser,
    } = useUserSetting()

    expect(favoriteModels.value).toEqual(['gpt-5.4'])

    await syncForUser('user-1')

    expect(favoriteModels.value).toEqual(['gemini-2.5-flash'])
    expect(localStorage.getItem('settings_favorite_models')).toBe(
      JSON.stringify(['gemini-2.5-flash']),
    )
  })

  it('updates local storage without API call for favorites guests', async () => {
    fetchMock.mockReset()
    const {
      favoriteModels,
      toggleFavoriteModel,
    } = useUserSetting()

    await toggleFavoriteModel('gpt-5.4')

    expect(favoriteModels.value).toEqual(['gpt-5.4'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('toggles a favorite off and persists it for authenticated users',
    async () => {
      fetchMock.mockReset()
        .mockResolvedValueOnce({
          reasoningExpanded: false,
          reasoningAutoHide: true,
          favoriteModels: ['gpt-5.4', 'gemini-2.5-flash'],
        })
        .mockResolvedValueOnce({
          favoriteModels: ['gemini-2.5-flash'],
        })
      const {
        syncForUser,
        favoriteModels,
        toggleFavoriteModel,
      } = useUserSetting()

      await syncForUser('user-1')
      await toggleFavoriteModel('gpt-5.4')

      expect(favoriteModels.value).toEqual(['gemini-2.5-flash'])
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/v1/profiles/settings',
        {
          method: 'PATCH',
          body: {
            favoriteModels: ['gemini-2.5-flash'],
          },
        },
      )
    })

  it('rolls back optimistic favoriteModels when the save fails', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
        favoriteModels: [],
      })
      .mockRejectedValueOnce(new Error('Save failed'))
    const {
      favoriteModels,
      settingsError,
      syncForUser,
      setFavoriteModels,
    } = useUserSetting()

    await syncForUser('user-1')

    const savePromise = setFavoriteModels(['gpt-5.4'])

    expect(favoriteModels.value).toEqual(['gpt-5.4'])
    await savePromise

    expect(favoriteModels.value).toEqual([])
    expect(settingsError.value).not.toBeNull()
  })

  it('applies only the latest toggle when responses resolve out of order',
    async () => {
      fetchMock.mockReset()
        .mockResolvedValueOnce({
          reasoningExpanded: false,
          reasoningAutoHide: true,
          favoriteModels: [],
        })
      const {
        syncForUser,
        favoriteModels,
        setFavoriteModels,
      } = useUserSetting()

      await syncForUser('user-1')

      let resolveFirstRequest: (value: unknown) => void = () => {}
      let resolveSecondRequest: (value: unknown) => void = () => {}

      fetchMock
        .mockImplementationOnce(() => new Promise((resolve) => {
          resolveFirstRequest = resolve
        }))
        .mockImplementationOnce(() => new Promise((resolve) => {
          resolveSecondRequest = resolve
        }))

      const callsBeforeSaves = fetchMock.mock.calls.length
      const firstSave = setFavoriteModels(['gpt-5.4'])
      const secondSave = setFavoriteModels(['gemini-2.5-flash'])

      resolveSecondRequest({})
      await secondSave

      resolveFirstRequest({})
      await firstSave

      expect(favoriteModels.value).toEqual(['gemini-2.5-flash'])
      expect(fetchMock.mock.calls.length - callsBeforeSaves).toBe(2)
    })

  it(
    'filters stale favorite ids from the derived list but keeps them '
    + 'in what gets persisted',
    async () => {
      fetchMock.mockReset()
        .mockResolvedValueOnce({
          reasoningExpanded: false,
          reasoningAutoHide: true,
          favoriteModels: ['gpt-5.4', 'legacy-model-removed'],
        })
      const {
        syncForUser,
        favoriteModels,
        toggleFavoriteModel,
      } = useUserSetting()

      await syncForUser('user-1')

      expect(favoriteModels.value).toEqual(['gpt-5.4'])

      fetchMock.mockResolvedValueOnce({
        favoriteModels: [
          'gpt-5.4',
          'legacy-model-removed',
          'gemini-2.5-flash',
        ],
      })

      await toggleFavoriteModel('gemini-2.5-flash')

      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/v1/profiles/settings',
        {
          method: 'PATCH',
          body: {
            favoriteModels: [
              'gpt-5.4',
              'legacy-model-removed',
              'gemini-2.5-flash',
            ],
          },
        },
      )
      expect(favoriteModels.value).toEqual(['gpt-5.4', 'gemini-2.5-flash'])
    },
  )

  it('uses the local storage fallback for gateway favorites before sync', () => {
    localStorage.setItem(
      'settings_favorite_gateway_models',
      JSON.stringify({ vercel: ['openai/gpt-4o'] }),
    )

    const { getFavoriteGatewayModels } = useUserSetting()

    expect(getFavoriteGatewayModels('vercel')).toEqual(['openai/gpt-4o'])
    expect(getFavoriteGatewayModels('openrouter')).toEqual([])
  })

  it('falls back to an empty map when stored gateway favorites are corrupt', () => {
    localStorage.setItem('settings_favorite_gateway_models', '{not json')

    const { favoriteGatewayModels } = useUserSetting()

    expect(favoriteGatewayModels.value).toEqual({})
  })

  it('syncs gateway favorites from the server response', async () => {
    fetchMock.mockResolvedValue({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      favoriteGatewayModels: {
        vercel: ['openai/gpt-4o'],
        openrouter: ['anthropic/claude-opus-5:free'],
      },
    })

    const { syncForUser, getFavoriteGatewayModels } = useUserSetting()

    await syncForUser('user-1')

    expect(getFavoriteGatewayModels('vercel')).toEqual(['openai/gpt-4o'])
    expect(getFavoriteGatewayModels('openrouter'))
      .toEqual(['anthropic/claude-opus-5:free'])
  })

  it('keeps the same model id favorited per gateway independently', async () => {
    fetchMock.mockReset().mockResolvedValueOnce({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      favoriteModels: ['gpt-5.4'],
      favoriteGatewayModels: { vercel: ['openai/gpt-4o'] },
    })

    const {
      syncForUser,
      favoriteModels,
      getFavoriteGatewayModels,
    } = useUserSetting()

    await syncForUser('user-1')

    expect(getFavoriteGatewayModels('vercel')).toEqual(['openai/gpt-4o'])
    expect(getFavoriteGatewayModels('openrouter')).toEqual([])
    expect(favoriteModels.value).toEqual(['gpt-5.4'])
    expect(favoriteModels.value).not.toContain('openai/gpt-4o')
  })

  it('toggles a gateway favorite without touching other gateways', async () => {
    fetchMock.mockReset().mockResolvedValueOnce({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      favoriteGatewayModels: {
        vercel: ['openai/gpt-4o'],
        openrouter: ['anthropic/claude-opus-5:free'],
      },
    })

    const {
      syncForUser,
      toggleFavoriteGatewayModel,
      getFavoriteGatewayModels,
    } = useUserSetting()

    await syncForUser('user-1')

    fetchMock.mockResolvedValueOnce({})

    await toggleFavoriteGatewayModel('openrouter', 'meta/llama-4')

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/profiles/settings',
      {
        method: 'PATCH',
        body: {
          favoriteGatewayModels: {
            vercel: ['openai/gpt-4o'],
            openrouter: ['anthropic/claude-opus-5:free', 'meta/llama-4'],
          },
        },
      },
    )
    expect(getFavoriteGatewayModels('vercel')).toEqual(['openai/gpt-4o'])
  })

  it('rolls back an optimistic gateway favorite when the save fails', async () => {
    fetchMock.mockReset().mockResolvedValueOnce({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      favoriteGatewayModels: { vercel: ['openai/gpt-4o'] },
    })

    const {
      syncForUser,
      toggleFavoriteGatewayModel,
      getFavoriteGatewayModels,
      settingsError,
    } = useUserSetting()

    await syncForUser('user-1')

    fetchMock.mockRejectedValueOnce(new Error('nope'))

    await toggleFavoriteGatewayModel('vercel', 'meta/llama-4')

    expect(getFavoriteGatewayModels('vercel')).toEqual(['openai/gpt-4o'])
    expect(settingsError.value).toBeTruthy()
  })

  it(
    'never filters gateway favorites against a catalog, so an unloaded '
    + 'catalog cannot wipe them',
    async () => {
      getProvidersMock.mockReturnValue({ providers: [] })
      fetchMock.mockReset().mockResolvedValueOnce({
        reasoningExpanded: false,
        reasoningAutoHide: true,
        favoriteGatewayModels: { vercel: ['openai/gpt-4o', 'meta/llama-4'] },
      })

      const {
        syncForUser,
        getFavoriteGatewayModels,
        toggleFavoriteGatewayModel,
      } = useUserSetting()

      await syncForUser('user-1')

      expect(getFavoriteGatewayModels('vercel'))
        .toEqual(['openai/gpt-4o', 'meta/llama-4'])

      fetchMock.mockResolvedValueOnce({})

      await toggleFavoriteGatewayModel('vercel', 'google/gemini-3')

      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/v1/profiles/settings',
        {
          method: 'PATCH',
          body: {
            favoriteGatewayModels: {
              vercel: ['openai/gpt-4o', 'meta/llama-4', 'google/gemini-3'],
            },
          },
        },
      )
    },
  )

  it('clears gateway favorites when the user context is cleared', async () => {
    fetchMock.mockResolvedValue({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      favoriteGatewayModels: { vercel: ['openai/gpt-4o'] },
    })

    const {
      syncForUser,
      clearUserContext,
      getFavoriteGatewayModels,
    } = useUserSetting()

    await syncForUser('user-1')

    expect(getFavoriteGatewayModels('vercel')).toEqual(['openai/gpt-4o'])

    clearUserContext()
    localStorage.clear()

    expect(getFavoriteGatewayModels('vercel')).toEqual([])
  })
})
