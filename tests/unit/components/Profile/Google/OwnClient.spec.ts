import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive, ref } from 'vue'
import OwnClient from '../../../../../app/components/Profile/Google/OwnClient.vue'
import { GOOGLE_CALENDAR_ACCESS_NOTE } from '#shared/utils/google-calendar-tools'
import type {
  GoogleByoConnectionStatus,
  GoogleConnectionStatusResponse,
  GoogleConnectionSummary,
} from '#shared/utils/google-connections'

enableAutoUnmount(afterEach)

const {
  fetchMock,
  refreshMock,
  confirmMock,
  navigateToMock,
  successMock,
  errorMock,
  infoMock,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  refreshMock: vi.fn(),
  confirmMock: vi.fn(),
  navigateToMock: vi.fn(),
  successMock: vi.fn(),
  errorMock: vi.fn(),
  infoMock: vi.fn(),
}))

const statusData = ref<GoogleConnectionStatusResponse | null>(null)
const mockRoute = reactive<{ query: Record<string, unknown> }>({ query: {} })
const gmailFeature = ref<{ active: boolean }>({ active: true })
const calendarFeature = ref<{ active: boolean }>({ active: true })

mockNuxtImport('useFeature', () => {
  return (key: string) => {
    return computed(() => {
      if (key === 'google.gmail') {
        return gmailFeature.value
      }

      return key === 'google.calendar' ? calendarFeature.value : { active: false }
    })
  }
})

mockNuxtImport('useGoogleConnection', () => {
  return () => ({
    data: statusData,
    status: ref('success'),
    refresh: refreshMock,
  })
})
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useConfirm', () => confirmMock)
mockNuxtImport('navigateTo', () => navigateToMock)
mockNuxtImport('useRoute', () => () => mockRoute)
mockNuxtImport('useSuccessMessage', () => successMock)
mockNuxtImport('useErrorMessage', () => errorMock)
mockNuxtImport('useInfoMessage', () => infoMock)

const REDIRECT_URI = 'https://besidka.com/api/v1/google/byo/callback'
const CLIENT_ID = 'owner-test-client-abcd.apps.googleusercontent.com'
const CLIENT_SECRET = 'test-owner-secret-value-0123456789'

function connection(
  patch: Partial<GoogleConnectionSummary> = {},
): GoogleConnectionSummary {
  return {
    clientMode: 'byo',
    status: 'active',
    email: 'owner@example.test',
    capabilities: ['identity', 'drive-read'],
    connectedAt: '2026-11-22T12:00:00.000Z',
    ...patch,
  }
}

function setByo(byo: Partial<GoogleByoConnectionStatus> | null) {
  statusData.value = {
    connection: null,
    canConnect: true,
    dedicatedClient: true,
    byo: byo
      ? {
        canManage: true,
        redirectUri: REDIRECT_URI,
        hasClient: false,
        connection: null,
        ...byo,
      }
      : null,
  }
}

async function mountOwnClient() {
  const wrapper = await mountSuspended(OwnClient, { attachTo: document.body })

  await flushPromises()

  return wrapper
}

describe('Profile/Google/OwnClient', () => {
  beforeEach(() => {
    setByo({})
    mockRoute.query = {}
    gmailFeature.value = { active: true }
    calendarFeature.value = { active: false }

    for (const mock of [
      fetchMock,
      refreshMock,
      confirmMock,
      navigateToMock,
      successMock,
      errorMock,
      infoMock,
    ]) {
      mock.mockReset()
    }
  })

  it('renders nothing without the own client in the status', async () => {
    setByo(null)

    const wrapper = await mountOwnClient()

    expect(wrapper.find('[data-testid="google-byo"]').exists()).toBe(false)
  })

  it('says it is for the owner and shows the redirect URI to copy',
    async () => {
      const writeText = vi.fn(async () => {})

      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

      const wrapper = await mountOwnClient()
      const explainer = wrapper.get('[data-testid="google-byo-explainer"]')

      expect(explainer.text()).toContain('owner of this Besidka instance')
      expect(explainer.text()).toContain('verification status')
      expect(wrapper.get('[data-testid="google-byo-redirect-uri"]').text())
        .toBe(REDIRECT_URI)

      await wrapper.get('[data-testid="google-byo-copy-redirect"]')
        .trigger('click')
      await flushPromises()

      expect(writeText).toHaveBeenCalledWith(REDIRECT_URI)
      expect(wrapper.get('[data-testid="google-byo-announcement"]').text())
        .toBe('Redirect URI copied.')
      vi.unstubAllGlobals()
    })

  it('offers no capabilities until a client is saved', async () => {
    const wrapper = await mountOwnClient()

    expect(wrapper.find('[data-testid="google-byo-capabilities-form"]')
      .exists()).toBe(false)
    expect(wrapper.find('[data-testid="google-byo-delete"]').exists())
      .toBe(false)
  })

  it('saves the client, then clears both fields', async () => {
    fetchMock.mockResolvedValue({ saved: true, connectionEnded: false })

    const wrapper = await mountOwnClient()
    const secret = wrapper.get('[data-testid="google-byo-client-secret"]')

    expect((secret.element as HTMLInputElement).type).toBe('password')
    expect((secret.element as HTMLInputElement).value).toBe('')
    expect(secret.attributes('autocomplete')).toBe('new-password')

    await wrapper.get('[data-testid="google-byo-client-id"]')
      .setValue(CLIENT_ID)
    await secret.setValue(CLIENT_SECRET)
    await wrapper.get('[data-testid="google-byo-client-form"]')
      .trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/profiles/keys/google-oauth-client',
      {
        method: 'POST',
        body: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
      },
    )
    expect(refreshMock).toHaveBeenCalled()
    expect((secret.element as HTMLInputElement).value).toBe('')
    expect(successMock).toHaveBeenCalledWith(
      'Google OAuth client saved',
      undefined,
    )
  })

  it('keeps Save disabled for an invalid client id', async () => {
    const wrapper = await mountOwnClient()

    await wrapper.get('[data-testid="google-byo-client-id"]')
      .setValue('not-a-client-id')
    await wrapper.get('[data-testid="google-byo-client-secret"]')
      .setValue(CLIENT_SECRET)

    expect(wrapper.get('[data-testid="google-byo-save"]')
      .attributes('disabled')).toBeDefined()
  })

  it('shows the server\'s refusal in an alert', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('Not saved'), {
      data: {
        message: 'This is not a Google OAuth client id',
        why: 'A client id ends with .apps.googleusercontent.com',
      },
    }))

    const wrapper = await mountOwnClient()

    await wrapper.get('[data-testid="google-byo-client-id"]')
      .setValue(CLIENT_ID)
    await wrapper.get('[data-testid="google-byo-client-secret"]')
      .setValue(CLIENT_SECRET)
    await wrapper.get('[data-testid="google-byo-client-form"]')
      .trigger('submit')
    await flushPromises()

    const alert = wrapper.get('[data-testid="google-byo-save-error"]')

    expect(alert.attributes('role')).toBe('alert')
    expect(alert.text()).not.toContain(CLIENT_SECRET)
  })

  it('says a client is saved and never shows it', async () => {
    setByo({ hasClient: true })

    const wrapper = await mountOwnClient()

    expect(wrapper.get('[data-testid="google-byo-client-saved"]').text())
      .toContain('A client is saved')
    expect(wrapper.html()).not.toContain(CLIENT_SECRET)
    expect(wrapper.html()).not.toContain(CLIENT_ID)
  })

  it('connects with only the ticked capabilities', async () => {
    calendarFeature.value = { active: true }
    setByo({ hasClient: true })
    fetchMock.mockResolvedValue({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
    })

    const wrapper = await mountOwnClient()
    const connect = wrapper.get('[data-testid="google-byo-connect"]')
    const ids = ['drive-read', 'gmail-read', 'gmail-compose', 'calendar']

    for (const id of ids) {
      const checkbox = wrapper.get(
        `[data-testid="google-byo-capability-${id}"]`,
      )

      expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    }

    expect(connect.attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="google-byo-capability-gmail-read"]')
      .setValue(true)
    await connect.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/google/byo/start', {
      method: 'POST',
      body: {
        capabilities: ['gmail-read'],
        returnTo: '/profile/keys?tab=google',
      },
    })
    expect(navigateToMock).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/v2/auth?x=1',
      { external: true },
    )
  })

  it('says what each access is for and what gmail.compose allows', async () => {
    calendarFeature.value = { active: true }
    setByo({ hasClient: true })

    const wrapper = await mountOwnClient()
    const text = wrapper
      .get('[data-testid="google-byo-capabilities-form"]')
      .text()

    expect(text).toContain('search and read your mail when you allow it')
    expect(text).toContain('search your files and read the ones it finds')
    expect(text).toContain('Google Calendar access lets it list events, '
      + 'check when you are busy and create one event you approve')
    expect(text).toContain('It adds no guests and sends no email')
    expect(text).toContain('creates events on calendars you own')
    expect(text).toContain('reads your free and busy time')
    expect(text).toContain('gmail.compose permission technically also '
      + 'allows sending mail')
    expect(text).toContain('it has no code that sends mail')
  })

  it('repeats what gmail.compose allows once it is granted', async () => {
    setByo({
      hasClient: true,
      connection: connection({
        capabilities: ['identity', 'gmail-read', 'gmail-compose'],
      }),
    })

    const wrapper = await mountOwnClient()

    expect(wrapper.get('[data-testid="google-byo-compose-note"]').text())
      .toContain('Besidka only ever creates drafts')
  })

  it('names no Gmail tool while Gmail is off in Labs', async () => {
    gmailFeature.value = { active: false }
    setByo({ hasClient: true, connection: connection() })

    const wrapper = await mountOwnClient()
    const hint = wrapper.get('[data-testid="google-byo-tools-hint"]').text()

    expect(hint).not.toContain('Gmail')
    expect(hint).toContain('read the files it found')
    expect(wrapper.find('[data-testid="google-byo-missing-tools"]').exists())
      .toBe(false)
  })

  it('offers no Calendar access and names no Calendar tool while Calendar is '
    + 'off in Labs', async () => {
    setByo({ hasClient: true })

    const wrapper = await mountOwnClient()

    expect(wrapper.find('[data-testid="google-byo-capability-calendar"]')
      .exists()).toBe(false)
    expect(wrapper.get('[data-testid="google-byo-capabilities-form"]').text())
      .not.toContain('Your Google Calendar events')

    setByo({ hasClient: true, connection: connection() })

    const connected = await mountOwnClient()

    expect(connected.get('[data-testid="google-byo-tools-hint"]').text())
      .not.toContain('Calendar')
    expect(connected.get('[data-testid="google-byo-missing-tools"]').text())
      .not.toContain('Calendar')
  })

  it('offers Calendar access with what its two permissions allow while '
    + 'Calendar is on in Labs', async () => {
    calendarFeature.value = { active: true }
    setByo({ hasClient: true })

    const wrapper = await mountOwnClient()
    const option = wrapper.get('[data-testid="google-byo-capabilities-form"]')

    expect(wrapper.find('[data-testid="google-byo-capability-calendar"]')
      .exists()).toBe(true)
    expect(option.text()).toContain('Your Google Calendar events')
    expect(option.text()).toContain('two narrow permissions')
    expect(option.text()).toContain('It adds no guests and sends no email')
    expect(option.text()).not.toContain('Google Calendar turned on in Labs')
  })

  it('points an owner without the Calendar opt-in to Labs, as it does for '
    + 'Gmail', async () => {
    calendarFeature.value = { active: false }
    setByo({ hasClient: true })

    const wrapper = await mountOwnClient()
    const form = wrapper.get('[data-testid="google-byo-capabilities-form"]')

    expect(form.text()).toContain(
      'Google Calendar tools need Google Calendar turned on in Labs',
    )
    expect(form.text()).toContain('Gmail tools need Gmail turned on in Labs')
    expect(wrapper.find('[data-testid="google-byo-capability-calendar"]')
      .exists()).toBe(false)
  })

  it('keeps every sentence of the Calendar access note short', () => {
    for (const sentence of GOOGLE_CALENDAR_ACCESS_NOTE.split(/(?<=\.)\s+/)) {
      expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20)
    }
  })

  it('says listing and creating work when only the events permission was '
    + 'granted', async () => {
    calendarFeature.value = { active: true }
    setByo({
      hasClient: true,
      connection: connection({ partialCalendar: 'events' }),
    })

    const wrapper = await mountOwnClient()
    const note = wrapper.get('[data-testid="google-byo-missing-tools"]').text()

    expect(note).toContain('Listing and creating Google Calendar events work')
    expect(note).toContain('Checking when you are busy needs the second')
    expect(note).not.toContain('needs Google Calendar access')
  })

  it('says free and busy works when only that permission was granted',
    async () => {
      calendarFeature.value = { active: true }
      setByo({
        hasClient: true,
        connection: connection({ partialCalendar: 'free-busy' }),
      })

      const wrapper = await mountOwnClient()
      const note = wrapper
        .get('[data-testid="google-byo-missing-tools"]')
        .text()

      expect(note).toContain('Checking when you are busy works')
      expect(note).toContain('needs the other Google Calendar permission')
    })

  it('shows the official Calendar mark on the Calendar row only, with no '
    + 'color class or opacity', async () => {
    calendarFeature.value = { active: true }
    setByo({ hasClient: true })

    const wrapper = await mountOwnClient()
    const mark = wrapper.get('[data-testid="google-byo-capability-calendar-icon"]')

    expect(mark.classes()).toContain('i-logos:google-calendar')
    expect(mark.classes().some(name => /^(text|opacity|fill)-/.test(name)))
      .toBe(false)
    expect(wrapper.find('[data-testid="google-byo-capability-gmail-read-icon"]')
      .exists()).toBe(false)
  })

  it('lists the Calendar tools in the hint and a note when Calendar access '
    + 'was not granted', async () => {
    calendarFeature.value = { active: true }
    setByo({ hasClient: true, connection: connection() })

    const wrapper = await mountOwnClient()

    expect(wrapper.get('[data-testid="google-byo-tools-hint"]').text())
      .toContain('invites nobody and sends no email')
    expect(wrapper.get('[data-testid="google-byo-missing-tools"]').text())
      .toContain('needs Google Calendar access')
  })

  it('never asks for Calendar when it is off in Labs, even if it was '
    + 'granted before', async () => {
    setByo({
      hasClient: true,
      connection: connection({
        capabilities: ['identity', 'drive-read', 'calendar'],
      }),
    })
    fetchMock.mockResolvedValue({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?z=3',
    })

    const wrapper = await mountOwnClient()

    await wrapper.get('[data-testid="google-byo-capability-gmail-read"]')
      .setValue(true)
    await wrapper.get('[data-testid="google-byo-connect"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/google/byo/start', {
      method: 'POST',
      body: {
        capabilities: ['drive-read', 'gmail-read'],
        returnTo: '/profile/keys?tab=google',
      },
    })
  })

  it('tells a connected owner where the tools work and which are off for '
    + 'missing access', async () => {
    setByo({ hasClient: true, connection: connection() })

    const wrapper = await mountOwnClient()
    const hint = wrapper
      .get('[data-testid="google-byo-missing-tools"]')
      .text()

    expect(wrapper.get('[data-testid="google-byo-tools-hint"]').text())
      .toContain('never send')
    expect(wrapper.get('[data-testid="google-byo-tools-hint"]').text())
      .toContain('gateway chat only after Google content is already in the chat')

    expect(hint).toContain('Searching and reading Gmail needs Gmail read')
    expect(hint).toContain('Writing Gmail drafts needs Gmail drafts access')
    expect(hint).not.toContain('Searching Google Drive')
  })

  it('shows no missing-tools hint when every tool has its access, or when '
    + 'the connection ended', async () => {
    setByo({
      hasClient: true,
      connection: connection({
        capabilities: [
          'identity',
          'drive-read',
          'gmail-read',
          'gmail-compose',
        ],
      }),
    })

    expect((await mountOwnClient())
      .find('[data-testid="google-byo-missing-tools"]').exists()).toBe(false)

    setByo({
      hasClient: true,
      connection: connection({ status: 'needs_reauth' }),
    })

    expect((await mountOwnClient())
      .find('[data-testid="google-byo-missing-tools"]').exists()).toBe(false)
  })

  it('shows the connected account and what Google granted', async () => {
    setByo({ hasClient: true, connection: connection() })

    const wrapper = await mountOwnClient()

    expect(wrapper.get('[data-testid="google-byo-status"]').text())
      .toBe('Connected')
    expect(wrapper.get('[data-testid="google-byo-email"]').text())
      .toBe('owner@example.test')
    expect(wrapper.get('[data-testid="google-byo-granted"]').text())
      .toContain('All your Google Drive files, read only')
  })

  it('lets a connected owner add a capability without disconnecting',
    async () => {
      calendarFeature.value = { active: true }
      setByo({ hasClient: true, connection: connection() })
      fetchMock.mockResolvedValue({
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?y=2',
      })

      const wrapper = await mountOwnClient()

      expect(wrapper.find('[data-testid="google-byo-capability-drive-read"]')
        .exists()).toBe(false)

      await wrapper.get('[data-testid="google-byo-capability-calendar"]')
        .setValue(true)

      const addAccess = wrapper.get('[data-testid="google-byo-connect"]')

      expect(addAccess.text()).toBe('Add access')

      await addAccess.trigger('click')
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/google/byo/start', {
        method: 'POST',
        body: {
          capabilities: ['drive-read', 'calendar'],
          returnTo: '/profile/keys?tab=google',
        },
      })
    })

  it('disconnects the own client behind a confirmation', async () => {
    setByo({ hasClient: true, connection: connection() })
    confirmMock.mockResolvedValue({ label: 'Disconnect', index: 0 })
    fetchMock.mockResolvedValue({
      disconnected: true,
      revoked: true,
      filesDeleted: 0,
      filesPending: false,
    })

    const wrapper = await mountOwnClient()

    await wrapper.get('[data-testid="google-byo-disconnect"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/google/connections/disconnect',
      { method: 'POST', body: { clientMode: 'byo' } },
    )
    expect(wrapper.get('[data-testid="google-byo-announcement"]').text())
      .toBe('Google disconnected.')
    expect(document.activeElement?.id).toBe('google-byo-heading')
  })

  it('styles Disconnect and Delete client as error outline buttons', async () => {
    setByo({ hasClient: true, connection: connection() })

    const wrapper = await mountOwnClient()

    for (const testId of ['google-byo-disconnect', 'google-byo-delete']) {
      const button = wrapper.get(`[data-testid="${testId}"]`)

      expect(button.classes()).toEqual(
        expect.arrayContaining(['btn', 'btn-error', 'btn-outline']),
      )
    }
  })

  it('does nothing when the disconnect is canceled', async () => {
    setByo({ hasClient: true, connection: connection() })
    confirmMock.mockResolvedValue(null)

    const wrapper = await mountOwnClient()

    await wrapper.get('[data-testid="google-byo-disconnect"]').trigger('click')
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deletes the client behind a confirmation', async () => {
    setByo({ hasClient: true })
    confirmMock.mockResolvedValue({ label: 'Delete', index: 0 })
    fetchMock.mockResolvedValue({
      deleted: true,
      connectionEnded: false,
      revoked: false,
    })

    const wrapper = await mountOwnClient()

    await wrapper.get('[data-testid="google-byo-delete"]').trigger('click')
    await flushPromises()

    expect(confirmMock.mock.calls[0]![0].subtitle)
      .toContain('A connection made with this client ends first')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/profiles/keys/google-oauth-client',
      { method: 'DELETE' },
    )
    expect(errorMock).not.toHaveBeenCalled()
  })

  it('keeps only Disconnect for a user who can no longer manage it',
    async () => {
      setByo({
        canManage: false,
        redirectUri: null,
        connection: connection(),
      })

      const wrapper = await mountOwnClient()

      expect(wrapper.find('[data-testid="google-byo-not-owner"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="google-byo-client-form"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="google-byo-redirect-uri"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="google-byo-disconnect"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="google-byo-delete"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="google-byo-connect"]').exists())
        .toBe(false)
    })

  it('lets a former owner delete the client they left behind', async () => {
    setByo({ canManage: false, redirectUri: null, hasClient: true })
    confirmMock.mockResolvedValue({ label: 'Delete', index: 0 })
    fetchMock.mockResolvedValue({
      deleted: true,
      connectionEnded: false,
      revoked: false,
    })

    const wrapper = await mountOwnClient()

    expect(wrapper.find('[data-testid="google-byo-client-form"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="google-byo-capabilities-form"]')
      .exists()).toBe(false)

    await wrapper.get('[data-testid="google-byo-delete"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/profiles/keys/google-oauth-client',
      { method: 'DELETE' },
    )
  })

  it('turns its own callback result into a toast and cleans the URL',
    async () => {
      mockRoute.query = { 'tab': 'google', 'google-byo': 'partial' }

      await mountOwnClient()

      expect(infoMock).toHaveBeenCalledWith(
        'Google granted only part of the access',
        'Only what Google granted is listed on this card.',
      )
      expect(refreshMock).toHaveBeenCalled()
      expect(navigateToMock).toHaveBeenCalledWith(
        { query: { tab: 'google' } },
        { replace: true },
      )
    })

  it('leaves the Drive card\'s callback result alone', async () => {
    mockRoute.query = { tab: 'google', google: 'connected' }

    await mountOwnClient()

    expect(successMock).not.toHaveBeenCalled()
    expect(navigateToMock).not.toHaveBeenCalled()
  })
})
