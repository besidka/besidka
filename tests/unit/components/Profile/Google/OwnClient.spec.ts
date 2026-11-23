import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive, ref } from 'vue'
import OwnClient from '../../../../../app/components/Profile/Google/OwnClient.vue'
import { GOOGLE_CALENDAR_ACCESS_NOTE } from '#shared/utils/google-calendar-tools'
import {
  GOOGLE_BYO_CAPABILITIES,
  getGoogleByoScopes,
} from '#shared/utils/google-byo'
import { GOOGLE_CONNECTORS_PATH } from '#shared/utils/google-connectors'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import { GOOGLE_CONNECTION_SCOPES } from '~~/server/utils/google/client'
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

    expect(wrapper.get('[data-testid="google-byo-save"]').classes())
      .toContain('btn-disabled')
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
    const ids = ['drive-read', 'gmail-read', 'gmail-compose', 'calendar']

    for (const id of ids) {
      const checkbox = wrapper.get(
        `[data-testid="google-byo-capability-${id}"]`,
      )

      expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    }

    expect(wrapper.get('[data-testid="google-byo-connect"]').classes())
      .toContain('btn-disabled')

    await wrapper.get('[data-testid="google-byo-capability-gmail-read"]')
      .setValue(true)
    await wrapper.get('[data-testid="google-byo-connect"]').trigger('click')
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

    const missing = wrapper.get('[data-testid="google-byo-missing-tools"]')

    expect(missing.text()).not.toContain('Gmail')
    expect(missing.text()).toContain('Changing files needs Change files '
      + 'access.')
    expect(missing.text()).not.toContain('Drive read access)')
  })

  it('shows no Change files note to an owner without Drive read access',
    async () => {
      setByo({
        hasClient: true,
        connection: connection({ capabilities: ['identity'] }),
      })

      const wrapper = await mountOwnClient()
      const missing = wrapper.get('[data-testid="google-byo-missing-tools"]')

      expect(missing.text()).not.toContain('Changing files')
      expect(missing.text()).toContain('Searching Google Drive')
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
          'drive-write',
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

  describe('the Change files checkbox', () => {
    const writeBox = '[data-testid="google-byo-capability-drive-write"]'
    const readBox = '[data-testid="google-byo-capability-drive-read"]'
    const lockedHint = '[data-testid="google-byo-capability-drive-write-locked"]'

    it('is nested under the read box and off until the read box is ticked',
      async () => {
        setByo({ hasClient: true })

        const wrapper = await mountOwnClient()
        const write = wrapper.get(writeBox)

        expect(write.attributes('disabled')).toBeDefined()
        expect((write.element as HTMLInputElement).checked).toBe(false)
        expect(wrapper.get(lockedHint).text())
          .toContain('Tick the read access first')
        expect(wrapper.get(writeBox).element.closest('label')?.classList)
          .toContain('ml-6')

        await wrapper.get(readBox).setValue(true)

        expect(wrapper.get(writeBox).attributes('disabled')).toBeUndefined()
        expect(wrapper.find(lockedHint).exists()).toBe(false)
      })

    it('says what it allows and that Besidka has no delete or share code',
      async () => {
        setByo({ hasClient: true })

        const text = (await mountOwnClient())
          .get('[data-testid="google-byo-capabilities-form"]')
          .text()

        expect(text).toContain('Change files in Google Drive')
        expect(text).toContain('Lets Besidka create folders, and rename and '
          + 'move files and folders you own, each time you approve, unless '
          + 'you set that tool to Always allow. Creating '
          + 'files will be added later.')
        expect(text).toContain('Google\'s permission for this also allows '
          + 'deleting and sharing; Besidka has no code that deletes or '
          + 'shares.')
      })

    it('clears itself when the read box is unticked', async () => {
      setByo({ hasClient: true })

      const wrapper = await mountOwnClient()

      await wrapper.get(readBox).setValue(true)
      await wrapper.get(writeBox).setValue(true)
      await wrapper.get(readBox).setValue(false)

      expect((wrapper.get(writeBox).element as HTMLInputElement).checked)
        .toBe(false)
      expect(wrapper.get(writeBox).attributes('disabled')).toBeDefined()
    })

    it('connects with both capabilities in one request', async () => {
      setByo({ hasClient: true })
      fetchMock.mockResolvedValue({
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?z=3',
      })

      const wrapper = await mountOwnClient()

      await wrapper.get(readBox).setValue(true)
      await wrapper.get(writeBox).setValue(true)
      await wrapper.get('[data-testid="google-byo-connect"]')
        .trigger('click')
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/google/byo/start', {
        method: 'POST',
        body: {
          capabilities: ['drive-read', 'drive-write'],
          returnTo: '/profile/keys?tab=google',
        },
      })
    })

    it('is enabled in Add access when read access is already granted',
      async () => {
        setByo({ hasClient: true, connection: connection() })
        fetchMock.mockResolvedValue({
          authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?w=4',
        })

        const wrapper = await mountOwnClient()

        expect(wrapper.get(writeBox).attributes('disabled')).toBeUndefined()

        await wrapper.get(writeBox).setValue(true)
        await wrapper.get('[data-testid="google-byo-connect"]')
          .trigger('click')
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/v1/google/byo/start', {
          method: 'POST',
          body: {
            capabilities: ['drive-read', 'drive-write'],
            returnTo: '/profile/keys?tab=google',
          },
        })
      })

    it('lists the grant and repeats the scope note once it is granted',
      async () => {
        setByo({
          hasClient: true,
          connection: connection({
            capabilities: ['identity', 'drive-read', 'drive-write'],
          }),
        })

        const wrapper = await mountOwnClient()

        expect(wrapper.get('[data-testid="google-byo-granted"]').text())
          .toContain('Change files in Google Drive')
        expect(wrapper.get('[data-testid="google-byo-drive-write-note"]')
          .text()).toContain('Besidka has no code that deletes or shares')
        expect(wrapper.find(writeBox).exists()).toBe(false)
      })

    it('tells what the model can do with the granted access and that it '
      + 'never deletes or shares', async () => {
      setByo({
        hasClient: true,
        connection: connection({
          capabilities: ['identity', 'drive-read', 'drive-write'],
        }),
      })

      const hint = (await mountOwnClient())
        .get('[data-testid="google-byo-tools-hint"]')
        .text()

      expect(hint).toContain('list your folders, create a folder in your '
        + 'own My Drive, and rename or move files and folders you own, '
        + 'after you approve each one, unless you set the tool to Always '
        + 'allow. Creating files will be added later.')
      expect(hint).toContain('It never deletes anything and never changes '
        + 'who can see a file.')
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

  it('lays Delete and Save out like the provider key card', async () => {
    setByo({ hasClient: true })

    const wrapper = await mountOwnClient()
    const remove = wrapper.get('[data-testid="google-byo-delete"]')
    const save = wrapper.get('[data-testid="google-byo-save"]')
    const row = save.element.parentElement?.parentElement as HTMLElement

    expect(remove.classes()).toEqual(expect.arrayContaining([
      'btn',
      'btn-error',
      'btn-outline',
      'w-full',
    ]))
    expect(save.classes()).toEqual(expect.arrayContaining([
      'btn',
      'btn-primary',
      'w-full',
    ]))
    expect(save.classes()).not.toContain('btn-sm')
    expect(remove.element.parentElement?.parentElement).toBe(row)
    expect(row.className).toBe(
      'max-md:grid md:flex md:place-content-end gap-2',
    )
    expect(
      remove.element.compareDocumentPosition(save.element)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(remove.text()).toBe('Delete')
    expect(remove.attributes('aria-label')).toBe('Delete client')
    expect(save.text()).toBe('Save')
    expect(save.attributes('aria-label')).toBe('Save client')
    expect(remove.html()).toContain('trash')
    expect(save.html()).toContain('cloud-upload')
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
        'Only what Google granted is listed here.',
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

  describe('reduced to the credential', () => {
    async function mountReduced() {
      const wrapper = await mountSuspended(OwnClient, {
        attachTo: document.body,
        props: { reduced: true },
      })

      await flushPromises()

      return wrapper
    }

    it('keeps the client form and points to the Connectors page', async () => {
      setByo({ hasClient: true })

      const wrapper = await mountReduced()

      expect(wrapper.find('[data-testid="google-byo-client-form"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="google-byo-delete"]').exists())
        .toBe(true)
      expect(wrapper.get('[data-testid="google-byo-connectors-line"]')
        .text().replace(/\s+/g, ' '))
        .toBe(
          'Connect Gmail, Google Calendar and whole-Drive search on the '
          + 'Connectors page.',
        )
      const link = wrapper.get('[data-testid="google-byo-connectors-link"]')

      expect(link.attributes('href') ?? link.attributes('to'))
        .toBe('/chats/connectors')
    })

    it('moves the capability boxes, Connect and Disconnect to the entries',
      async () => {
        setByo({
          hasClient: true,
          connection: connection({ capabilities: ['identity', 'gmail-read'] }),
        })

        const wrapper = await mountReduced()

        expect(wrapper.find('[data-testid="google-byo-capabilities-form"]')
          .exists()).toBe(false)
        expect(wrapper.find('[data-testid="google-byo-connect"]').exists())
          .toBe(false)
        expect(wrapper.find('[data-testid="google-byo-disconnect"]').exists())
          .toBe(false)
        expect(wrapper.find('[data-testid="google-byo-email"]').exists())
          .toBe(false)
      })

    it('keeps Delete client and Disconnect for a former owner', async () => {
      setByo({
        canManage: false,
        redirectUri: null,
        hasClient: true,
        connection: connection(),
      })

      const wrapper = await mountReduced()

      expect(wrapper.find('[data-testid="google-byo-connectors-line"]')
        .exists()).toBe(false)
      expect(wrapper.find('[data-testid="google-byo-delete"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="google-byo-disconnect"]').exists())
        .toBe(true)
    })

    it('is the full card by default', async () => {
      setByo({ hasClient: true })

      const wrapper = await mountOwnClient()

      expect(wrapper.find('[data-testid="google-byo-connectors-line"]')
        .exists()).toBe(false)
      expect(wrapper.find('[data-testid="google-byo-capabilities-form"]')
        .exists()).toBe(true)
    })
  })

  describe('setup guide', () => {
    const SCOPE_URL_PATTERN = /https:\/\/www\.googleapis\.com\/auth\/[a-z.]+|openid/g

    async function mountReduced() {
      const wrapper = await mountSuspended(OwnClient, {
        props: { reduced: true },
        attachTo: document.body,
      })

      await flushPromises()

      return wrapper
    }

    it('sits at the bottom of the card, after the actions row', async () => {
      setByo({ hasClient: true })

      const wrapper = await mountOwnClient()
      const guide = wrapper.get('[data-testid="google-byo-guide"]')
      const save = wrapper.get('[data-testid="google-byo-save"]')
      const section = wrapper.get('[data-testid="google-byo"]')

      expect(
        save.element.compareDocumentPosition(guide.element)
        & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(section.element.lastElementChild).toBe(guide.element)
    })

    it('sits after the actions row in the reduced card too', async () => {
      const wrapper = await mountReduced()
      const guide = wrapper.get('[data-testid="google-byo-guide"]')
      const save = wrapper.get('[data-testid="google-byo-save"]')

      expect(
        save.element.compareDocumentPosition(guide.element)
        & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(wrapper.get('[data-testid="google-byo"]').element.lastElementChild)
        .toBe(guide.element)
    })

    it('is collapsed by default with a clear summary line', async () => {
      const wrapper = await mountOwnClient()
      const guide = wrapper.get('[data-testid="google-byo-guide"]')
      const summary = wrapper.get('[data-testid="google-byo-guide-summary"]')

      expect(guide.element.tagName).toBe('DETAILS')
      expect((guide.element as HTMLDetailsElement).open).toBe(false)
      expect(guide.attributes('open')).toBeUndefined()
      expect(summary.element.tagName).toBe('SUMMARY')
      expect(summary.text()).toBe('How to set up your own Google client')
    })

    it('expands to the steps and the failure list', async () => {
      const wrapper = await mountOwnClient()
      const guide = wrapper.get('[data-testid="google-byo-guide"]')

      ;(guide.element as HTMLDetailsElement).open = true
      await flushPromises()

      expect((guide.element as HTMLDetailsElement).open).toBe(true)
      expect(guide.findAll(
        '[data-testid="google-byo-guide-steps"] > li',
      )).toHaveLength(7)
      expect(guide.get('[data-testid="google-byo-guide-warning"]').text())
        .toContain('every 7 days')
      expect(guide.get('[data-testid="google-byo-guide-failures"]').text())
        .toContain('The Gmail API is not turned on')
    })

    it('names redirect_uri_mismatch as its own failure entry', async () => {
      const wrapper = await mountOwnClient()
      const entry = wrapper
        .get('[data-testid="google-byo-guide-redirect-mismatch"]')
        .text()
      const failures = wrapper
        .get('[data-testid="google-byo-guide-failures"]')
        .text()

      expect(entry).toContain('redirect_uri_mismatch')
      expect(entry).toContain('does not match an authorized redirect URI')
      expect(entry).toContain('scheme, host, path, no trailing slash')
      expect(entry).toContain('one entry for each host')
      expect(entry).toContain('about 5 minutes to a few hours')
      expect(failures).toContain('Google could not be connected')
    })

    it('presents Publish app and Testing as an honest choice', async () => {
      const wrapper = await mountOwnClient()
      const publish = wrapper
        .get('[data-testid="google-byo-guide-publish"]')
        .text()
      const testing = wrapper
        .get('[data-testid="google-byo-guide-testing"]')
        .text()
      const steps = wrapper
        .get('[data-testid="google-byo-guide-steps"]')
        .text()

      expect(publish).toContain('Recommended: publish the app')
      expect(publish).toContain('Publish app')
      expect(publish).toContain('"In production"')
      expect(publish).toContain('ends the 7-day expiry')
      expect(publish).toContain('Google hasn\'t verified this app')
      expect(testing).toContain('Alternative: stay in Testing')
      expect(testing).toContain('test user')
      expect(testing).toContain('every 7 days')
      expect(steps).toContain('application home page and a privacy policy')
      expect(steps).toContain('a link to any page you control is enough')
      expect(steps).toContain('developer contact email')
    })

    it('tells the user to check the project picker in steps 1 and 2',
      async () => {
        const wrapper = await mountOwnClient()
        const steps = wrapper.findAll(
          '[data-testid="google-byo-guide-steps"] > li',
        )

        expect(steps[0]?.text()).toContain('project picker')
        expect(steps[1]?.text()).toContain('project picker')
        expect(steps[1]?.text()).toContain('"API is not turned on" error')
      })

    it('has a test list entry that applies only in Testing', async () => {
      const wrapper = await mountOwnClient()
      const entry = wrapper
        .get('[data-testid="google-byo-guide-test-users"]')
        .text()

      expect(entry).toContain('only listed test users can connect')
      expect(entry).toContain('Audience, Test users')
      expect(entry).toContain('only in Testing')
    })

    it('links only to the Google Cloud console', async () => {
      const wrapper = await mountOwnClient()
      const links = wrapper.findAll(
        '[data-testid="google-byo-guide"] a[target="_blank"]',
      )

      expect(links.length).toBeGreaterThan(0)

      for (const link of links) {
        expect(link.attributes('href') ?? link.attributes('to'))
          .toMatch(/^https:\/\/console\.cloud\.google\.com\//)
        expect(link.attributes('rel')).toContain('noopener')
      }
    })

    it('lists exactly the scopes the own client requests', async () => {
      const wrapper = await mountOwnClient()
      const listed = wrapper
        .get('[data-testid="google-byo-guide-scopes"]')
        .text()
        .match(SCOPE_URL_PATTERN) ?? []
      const expected = [
        ...GOOGLE_CONNECTION_SCOPES.byo,
        ...getGoogleByoScopes([...GOOGLE_BYO_CAPABILITIES]),
      ]

      expect([...new Set(listed)].sort()).toEqual([...expected].sort())
      expect(listed).not.toContain(GOOGLE_SCOPES.driveFile)
      expect(listed).not.toContain(GOOGLE_SCOPES.profile)
    })

    it('shows the redirect path without a host and never the client',
      async () => {
        setByo({ hasClient: true })

        const wrapper = await mountOwnClient()
        const guide = wrapper.get('[data-testid="google-byo-guide"]')

        expect(guide.text()).toContain('/api/v1/google/byo/callback')
        expect(guide.text()).not.toContain('https://besidka.com')
        expect(guide.text()).not.toContain(CLIENT_ID)
        expect(guide.text()).not.toContain(CLIENT_SECRET)
      })

    it('sends the full card to Connect on the card itself', async () => {
      const wrapper = await mountOwnClient()
      const guide = wrapper.get('[data-testid="google-byo-guide"]')

      expect(guide.find('[data-testid="google-byo-guide-connectors-link"]')
        .exists()).toBe(false)
      expect(guide.get('[data-testid="google-byo-guide-warning"]').text())
        .toContain('press Reconnect on this card')
    })

    it('shows in the reduced card and sends it to Connectors', async () => {
      const wrapper = await mountReduced()
      const guide = wrapper.get('[data-testid="google-byo-guide"]')

      expect((guide.element as HTMLDetailsElement).open).toBe(false)
      const link = guide.get('[data-testid="google-byo-guide-connectors-link"]')

      expect(link.attributes('href') ?? link.attributes('to'))
        .toBe(GOOGLE_CONNECTORS_PATH)
      expect(guide.get('[data-testid="google-byo-guide-warning"]').text())
        .toContain('use the Connectors page')
    })

    describe('narrow screens', () => {
      const WRAP_CLASS = '[overflow-wrap:anywhere]'

      async function expectNarrowClasses(
        wrapper: Awaited<ReturnType<typeof mountOwnClient>>,
      ) {
        const guide = wrapper.get('[data-testid="google-byo-guide"]')
        const content = guide.get('[data-testid="google-byo-guide-content"]')

        expect(guide.classes()).toContain('min-w-0')
        expect(guide.classes()).toContain('max-w-full')
        expect(content.classes()).toContain('min-w-0')
        expect(content.classes()).toContain('max-w-full')
        expect(content.classes()).toContain(WRAP_CLASS)
        expect(content.element.parentElement?.classList.contains('min-w-0'))
          .toBe(true)

        const scopeList = guide.get('[data-testid="google-byo-guide-scopes"]')
        const scopeItems = scopeList.findAll('li')

        expect(scopeItems.length).toBeGreaterThan(0)

        for (const item of scopeItems) {
          expect(item.classes()).toContain(WRAP_CLASS)
        }

        const codeElements = guide.findAll('code')

        expect(codeElements.length).toBeGreaterThan(0)

        for (const code of codeElements) {
          expect(code.classes()).toContain(WRAP_CLASS)
        }

        expect(wrapper.get('[data-testid="google-byo"]').classes())
          .toContain('min-w-0')
      }

      it('lets the full card shrink and wrap long strings', async () => {
        setByo({ hasClient: true })

        const wrapper = await mountOwnClient()

        await expectNarrowClasses(wrapper)
        expect(wrapper.get('[data-testid="google-byo-capabilities-form"]')
          .classes()).toContain('min-w-0')
      })

      it('lets the reduced card shrink and wrap long strings', async () => {
        const wrapper = await mountReduced()

        await expectNarrowClasses(wrapper)
      })

      it('keeps the redirect address box wrappable', async () => {
        const wrapper = await mountOwnClient()
        const address = wrapper.get('[data-testid="google-byo-redirect-uri"]')

        expect(address.classes()).toContain('min-w-0')
        expect(address.classes()).toContain('break-all')
        expect(address.element.parentElement?.parentElement?.classList
          .contains('min-w-0')).toBe(true)
      })
    })

    it('is hidden for a user who cannot manage an own client', async () => {
      setByo({ canManage: false, redirectUri: null, hasClient: true })

      const full = await mountOwnClient()

      expect(full.find('[data-testid="google-byo-guide"]').exists())
        .toBe(false)

      const reduced = await mountReduced()

      expect(reduced.find('[data-testid="google-byo-guide"]').exists())
        .toBe(false)
    })

    it('is hidden when the status carries no own client', async () => {
      setByo(null)

      const wrapper = await mountOwnClient()

      expect(wrapper.find('[data-testid="google-byo-guide"]').exists())
        .toBe(false)
    })
  })
})
