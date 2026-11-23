import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import {
  useGoogleEntries,
  useGoogleEntryActions,
} from '../../../app/composables/google-entries'
import type { GoogleEntry } from '../../../app/utils/google-entries'
import type {
  GoogleByoConnectionStatus,
  GoogleConnectionStatusResponse,
  GoogleConnectionSummary,
} from '#shared/utils/google-connections'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  navigateTo: vi.fn(),
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  refresh: vi.fn(),
}))

const statusData = ref<GoogleConnectionStatusResponse | null>(null)
const features = ref<Record<string, boolean>>({})

mockNuxtImport('useGoogleConnection', () => {
  return () => ({
    data: statusData,
    status: ref('success'),
    refresh: mocks.refresh,
  })
})
mockNuxtImport('useFeature', () => {
  return (key: string) => computed(() => {
    const isActive = features.value[key] === true

    return { enabled: isActive, active: isActive, variant: null }
  })
})
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('navigateTo', () => mocks.navigateTo)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useErrorMessage', () => mocks.error)

function summary(
  patch: Partial<GoogleConnectionSummary> = {},
): GoogleConnectionSummary {
  return {
    clientMode: 'besidka',
    status: 'active',
    email: 'person@example.test',
    isWorkspaceAccount: false,
    capabilities: ['identity', 'drive-picked'],
    connectedAt: '2026-11-22T12:00:00.000Z',
    ...patch,
  }
}

function setStatus(
  patch: Partial<GoogleConnectionStatusResponse> = {},
  byo: Partial<GoogleByoConnectionStatus> | null = null,
) {
  statusData.value = {
    connection: null,
    canConnect: true,
    dedicatedClient: true,
    byo: byo
      ? {
        canManage: true,
        redirectUri: 'https://besidka.example/api/v1/google/byo/callback',
        hasClient: true,
        connection: null,
        ...byo,
      }
      : null,
    ...patch,
  }
}

function entryOf(id: GoogleEntry['id']): GoogleEntry {
  const { entries } = useGoogleEntries()

  return entries.value.find(entry => entry.id === id)!
}

describe('useGoogleEntries', () => {
  beforeEach(() => {
    features.value = {
      'google.drive': true,
      'google.gmail': true,
      'google.calendar': true,
    }
  })

  it('resolves the entries from the status and the flags', () => {
    setStatus({}, {})

    const { entries } = useGoogleEntries()

    expect(entries.value.map(entry => entry.id)).toEqual([
      'google-drive',
      'google-gmail',
      'google-calendar',
    ])
  })

  it('lists nothing before the status loads', () => {
    statusData.value = null

    expect(useGoogleEntries().entries.value).toEqual([])
  })

  it('reads a flag that is off as Off in Labs', () => {
    features.value = { 'google.drive': true, 'google.gmail': false }
    setStatus({}, {})

    expect(entryOf('google-gmail').state).toBe('off-in-labs')
  })
})

describe('useGoogleEntryActions', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset()
    }

    features.value = {
      'google.drive': true,
      'google.gmail': true,
      'google.calendar': true,
    }
    mocks.fetch.mockResolvedValue({
      authorizationUrl: 'https://accounts.example/consent',
    })
    mocks.confirm.mockResolvedValue({ label: 'Disconnect', index: 0 })
  })

  afterEach(() => {
    useGoogleEntryActions().isBusy.value = false
    useGoogleEntryActions().announcement.value = ''
  })

  it('connects Google Drive on Besidka\'s client and returns to its panel',
    async () => {
      setStatus()

      await useGoogleEntryActions().run(entryOf('google-drive'))

      expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/google/oauth/start', {
        method: 'POST',
        body: { returnTo: '/chats/connectors?panel=google-drive' },
      })
      expect(mocks.navigateTo).toHaveBeenCalledWith(
        'https://accounts.example/consent',
        { external: true },
      )
    })

  it('connects Gmail with both Gmail capabilities and returns to its panel',
    async () => {
      setStatus({}, {})

      await useGoogleEntryActions().run(entryOf('google-gmail'))

      expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/google/byo/start', {
        method: 'POST',
        body: {
          capabilities: ['gmail-read', 'gmail-compose'],
          returnTo: '/chats/connectors?panel=google-gmail',
        },
      })
    })

  it('connects Calendar without dropping the Gmail access already granted',
    async () => {
      setStatus({}, {
        connection: summary({
          clientMode: 'byo',
          capabilities: ['identity', 'gmail-read', 'gmail-compose'],
        }),
      })

      await useGoogleEntryActions().run(entryOf('google-calendar'))

      expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/google/byo/start', {
        method: 'POST',
        body: {
          capabilities: ['gmail-read', 'gmail-compose', 'calendar'],
          returnTo: '/chats/connectors?panel=google-calendar',
        },
      })
    })

  it('never asks for Calendar while it is off in Labs', async () => {
    features.value['google.calendar'] = false
    setStatus({}, {
      connection: summary({
        clientMode: 'byo',
        capabilities: ['identity', 'gmail-read', 'calendar'],
      }),
    })

    await useGoogleEntryActions().run(entryOf('google-gmail'))

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/google/byo/start', {
      method: 'POST',
      body: {
        capabilities: ['gmail-read', 'gmail-compose'],
        returnTo: '/chats/connectors?panel=google-gmail',
      },
    })
  })

  it('adds Drive read access next to what is granted', async () => {
    setStatus({}, {
      connection: summary({
        clientMode: 'byo',
        capabilities: ['identity', 'gmail-read'],
      }),
    })

    await useGoogleEntryActions().addDriveSearchAccess(entryOf('google-drive'))

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/google/byo/start', {
      method: 'POST',
      body: {
        capabilities: ['gmail-read', 'drive-read'],
        returnTo: '/chats/connectors?panel=google-drive',
      },
    })
  })

  it('adds Change files access next to what is granted and returns to '
    + 'the Drive panel', async () => {
    setStatus({}, {
      connection: summary({
        clientMode: 'byo',
        capabilities: ['identity', 'gmail-read', 'drive-read'],
      }),
    })

    await useGoogleEntryActions().addDriveWriteAccess(entryOf('google-drive'))

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/google/byo/start', {
      method: 'POST',
      body: {
        capabilities: ['drive-read', 'gmail-read', 'drive-write'],
        returnTo: '/chats/connectors?panel=google-drive',
      },
    })
    expect(mocks.navigateTo).toHaveBeenCalled()
  })

  it('shows the server\'s reason when the connect cannot start', async () => {
    setStatus()
    mocks.fetch.mockRejectedValue({
      data: { message: 'Google is not set up', why: 'No client' },
    })

    const actions = useGoogleEntryActions()

    await actions.run(entryOf('google-drive'))

    expect(mocks.error).toHaveBeenCalledWith(
      'Google is not set up',
      'No client',
    )
    expect(mocks.navigateTo).not.toHaveBeenCalled()
    expect(actions.isBusy.value).toBe(false)
  })

  it('opens a link action without calling a route', async () => {
    setStatus({}, { hasClient: false })

    await useGoogleEntryActions().run(entryOf('google-gmail'))

    expect(mocks.navigateTo).toHaveBeenCalledWith('/profile/keys?tab=google')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('disconnects Google Drive after a confirmation that names the copies',
    async () => {
      setStatus({ connection: summary() })
      mocks.fetch.mockResolvedValue({ revoked: true, filesPending: false })

      const actions = useGoogleEntryActions()
      const isDone = await actions.disconnect(entryOf('google-drive'))

      expect(isDone).toBe(true)
      expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
        text: 'Disconnect Google Drive?',
        subtitle: expect.stringContaining('will be deleted'),
        alert: true,
        actions: ['Disconnect'],
      }))
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/google/connections/disconnect',
        { method: 'POST' },
      )
      expect(mocks.refresh).toHaveBeenCalled()
      expect(mocks.success).toHaveBeenCalledWith(
        'Google Drive disconnected',
        'The copied Google Drive files were deleted.',
      )
      expect(actions.announcement.value).toBe('Google Drive disconnected.')
    })

  it('names every service when the own-client grant is disconnected',
    async () => {
      setStatus({}, {
        connection: summary({
          clientMode: 'byo',
          capabilities: ['identity', 'gmail-read', 'gmail-compose'],
        }),
      })
      mocks.fetch.mockResolvedValue({ revoked: true, filesPending: false })

      const actions = useGoogleEntryActions()
      const isDone = await actions.disconnect(entryOf('google-gmail'))
      const subtitle = mocks.confirm.mock.calls[0]![0].subtitle as string

      expect(isDone).toBe(true)
      expect(mocks.confirm.mock.calls[0]![0].text)
        .toBe('Disconnect your own Google client?')
      expect(subtitle).toContain('Gmail, Google Calendar and whole-Drive search')
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/google/connections/disconnect',
        { method: 'POST', body: { clientMode: 'byo' } },
      )
      expect(actions.announcement.value).toContain('Gmail, Google Calendar')
    })

  it('does nothing when the confirmation is declined', async () => {
    setStatus({ connection: summary() })
    mocks.confirm.mockResolvedValue(null)

    const isDone = await useGoogleEntryActions()
      .disconnect(entryOf('google-drive'))

    expect(isDone).toBe(false)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('tells the user to remove the access at Google when it was not revoked',
    async () => {
      setStatus({ connection: summary() })
      mocks.fetch.mockResolvedValue({ revoked: false, filesPending: true })

      await useGoogleEntryActions().disconnect(entryOf('google-drive'))

      expect(mocks.success).toHaveBeenCalledWith(
        'Google Drive disconnected',
        expect.stringContaining('being deleted'),
      )
      expect(mocks.error).toHaveBeenCalledWith(
        'Google did not confirm that Besidka\'s access was removed',
        expect.stringContaining('myaccount.google.com'),
      )
    })

  it('ignores an action while another one runs', async () => {
    setStatus()

    const actions = useGoogleEntryActions()

    actions.isBusy.value = true
    await actions.run(entryOf('google-drive'))

    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
