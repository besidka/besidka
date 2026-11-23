import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import GoogleDetailPanel from '../../../../../app/components/Profile/Connectors/GoogleDetailPanel.vue'
import { resolveGoogleEntries } from '../../../../../app/utils/google-entries'
import type {
  GoogleByoConnectionStatus,
  GoogleConnectionStatusResponse,
  GoogleConnectionSummary,
} from '#shared/utils/google-connections'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  disconnect: vi.fn(),
  addDriveSearchAccess: vi.fn(),
  refresh: vi.fn(),
}))

const statusData = ref<GoogleConnectionStatusResponse | null>(null)
const loadStatus = ref<string>('success')
const announcement = ref<string>('')
const isBusy = ref<boolean>(false)

mockNuxtImport('useGoogleEntries', () => {
  return () => ({
    data: statusData,
    status: loadStatus,
    refresh: mocks.refresh,
    isCalendarActive: ref(true),
    entries: computed(() => {
      return resolveGoogleEntries({
        status: statusData.value,
        driveFeature: { enabled: true, active: true },
        isGmailActive: true,
        isCalendarActive: true,
      })
    }),
  })
})
mockNuxtImport('useGoogleEntryActions', () => {
  return () => ({
    isBusy,
    announcement,
    run: mocks.run,
    disconnect: mocks.disconnect,
    addDriveSearchAccess: mocks.addDriveSearchAccess,
  })
})

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

async function mountPanel(entryId: string) {
  const wrapper = await mountSuspended(GoogleDetailPanel, {
    props: { entryId },
  })

  await flushPromises()

  return wrapper
}

function toolNames(wrapper: Awaited<ReturnType<typeof mountPanel>>) {
  return wrapper.findAll('[data-testid="google-detail-tool"]')
    .map(tool => tool.attributes('data-tool-name'))
}

describe('Profile/Connectors/GoogleDetailPanel', () => {
  beforeEach(() => {
    statusData.value = null
    loadStatus.value = 'success'
    announcement.value = ''
    isBusy.value = false

    for (const mock of Object.values(mocks)) {
      mock.mockReset()
    }
  })

  it('shows a skeleton while the status loads', async () => {
    loadStatus.value = 'pending'

    const wrapper = await mountPanel('google-drive')

    expect(wrapper.find('[data-testid="side-panel-skeleton"]').exists())
      .toBe(true)
  })

  it('offers Try again when the status failed to load', async () => {
    loadStatus.value = 'error'

    const wrapper = await mountPanel('google-drive')

    await wrapper.get('[data-testid="google-detail-retry"]')
      .trigger('click')

    expect(wrapper.get('[data-testid="google-detail-error"]').text())
      .toContain('could not be loaded')
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('says a service is not available when it is not listed', async () => {
    setStatus()

    const wrapper = await mountPanel('google-gmail')

    expect(wrapper.get('[data-testid="google-detail-missing"]').text())
      .toContain('not available for your account')
  })

  it('treats an unknown entry id as not available', async () => {
    setStatus()

    const wrapper = await mountPanel('google-evil')

    expect(wrapper.find('[data-testid="google-detail-missing"]').exists())
      .toBe(true)
  })

  describe('Google Drive', () => {
    it('shows the header, the state and Connect', async () => {
      setStatus()

      const wrapper = await mountPanel('google-drive')

      expect(wrapper.get('[data-testid="google-detail-title"]').text())
        .toBe('Google Drive')
      expect(wrapper.get('[data-testid="google-detail-badge"]').text())
        .toBe('Built in')
      expect(wrapper.get('[data-testid="google-detail-state"]').text())
        .toBe('Not connected')
      expect(wrapper.get('[data-testid="google-detail-description"]').text())
        .toContain('Files you pick.')
      expect(wrapper.get('[data-testid="google-detail-action"]').text())
        .toBe('Connect Google Drive')
      expect(wrapper.find('[data-testid="google-detail-disconnect"]').exists())
        .toBe(false)

      await wrapper.get('[data-testid="google-detail-action"]')
        .trigger('click')

      expect(mocks.run).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'google-drive', action: 'connect' }),
      )
    })

    it('shows the email and Disconnect when connected', async () => {
      setStatus({ connection: summary() })

      const wrapper = await mountPanel('google-drive')

      expect(wrapper.get('[data-testid="google-detail-state"]').text())
        .toBe('person@example.test')
      expect(wrapper.find('[data-testid="google-detail-action"]').exists())
        .toBe(false)

      await wrapper.get('[data-testid="google-detail-disconnect"]')
        .trigger('click')

      expect(mocks.disconnect).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'google-drive' }),
      )
    })

    it('lists the three picked-file tools read-only and nothing else for a '
      + 'user without the own client', async () => {
      setStatus()

      const wrapper = await mountPanel('google-drive')

      expect(toolNames(wrapper)).toEqual([
        'google__drive_list_picked',
        'google__drive_read_file',
        'google__drive_save_file',
      ])
      expect(wrapper.findAll('[data-testid="google-detail-tool-approval"]')
        .map(label => label.text())).toEqual([
        'Needs approval',
        'Needs approval',
        'Asks every time',
      ])
      expect(wrapper.find('select').exists()).toBe(false)
      expect(wrapper.find('input').exists()).toBe(false)
      expect(wrapper.find('[role="radio"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="google-detail-own-client"]').exists())
        .toBe(false)
    })

    it('adds the whole-Drive tools for the owner and asks for the access',
      async () => {
        setStatus({}, {})

        const wrapper = await mountPanel('google-drive')

        expect(toolNames(wrapper)).toEqual([
          'google__drive_list_picked',
          'google__drive_read_file',
          'google__drive_search',
          'google__drive_read_found_file',
          'google__drive_save_file',
        ])
        expect(wrapper.get('[data-testid="google-detail-own-client-hint"]')
          .text()).toContain('needs Google Drive read access')

        await wrapper.get('[data-testid="google-detail-own-client-add-access"]')
          .trigger('click')

        expect(mocks.addDriveSearchAccess).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'google-drive' }),
        )
      })

    it('asks the owner for the own client first', async () => {
      setStatus({}, { hasClient: false })

      const wrapper = await mountPanel('google-drive')
      const link = wrapper.get('[data-testid="google-detail-own-client-link"]')

      expect(wrapper.get('[data-testid="google-detail-own-client-hint"]')
        .text()).toContain('needs your own Google client')
      expect(link.attributes('href') ?? link.attributes('to'))
        .toBe('/profile/keys?tab=google')
    })

    it('has no own-client hint once Drive read access is granted',
      async () => {
        setStatus({}, {
          connection: summary({
            clientMode: 'byo',
            capabilities: ['identity', 'drive-read'],
          }),
        })

        const wrapper = await mountPanel('google-drive')

        expect(wrapper.find('[data-testid="google-detail-own-client"]')
          .exists()).toBe(false)
      })
  })

  describe('Gmail', () => {
    it('lists the read and write tools with the right labels', async () => {
      setStatus({}, {})

      const wrapper = await mountPanel('google-gmail')

      expect(wrapper.get('[data-testid="google-detail-tools-read"] h4').text())
        .toBe('Read')
      expect(wrapper.get('[data-testid="google-detail-tools-write"] h4').text())
        .toBe('Write')
      expect(toolNames(wrapper)).toEqual([
        'google__gmail_search',
        'google__gmail_read_thread',
        'google__gmail_create_draft',
      ])
      expect(wrapper.findAll('[data-testid="google-detail-tool-approval"]')
        .map(label => label.text())).toEqual([
        'Needs approval',
        'Asks every time',
        'Asks every time',
      ])
    })

    it('offers Add access for a partial grant and Disconnect', async () => {
      setStatus({}, {
        connection: summary({
          clientMode: 'byo',
          capabilities: ['identity', 'gmail-read'],
        }),
      })

      const wrapper = await mountPanel('google-gmail')

      expect(wrapper.get('[data-testid="google-detail-state"]').text())
        .toBe('Drafts access not granted')
      expect(wrapper.get('[data-testid="google-detail-action"]').text())
        .toBe('Add access')
      expect(wrapper.find('[data-testid="google-detail-disconnect"]').exists())
        .toBe(true)
    })

    it('says in the info note that Besidka never sends mail', async () => {
      setStatus({}, {})

      const wrapper = await mountPanel('google-gmail')

      expect(wrapper.find('[data-testid="google-detail-info"]').exists())
        .toBe(false)

      await wrapper.get('[data-testid="google-detail-info-toggle"]')
        .trigger('click')

      expect(wrapper.get('[data-testid="google-detail-info-toggle"]')
        .attributes('aria-expanded')).toBe('true')
      expect(wrapper.get('[data-testid="google-detail-info"]').text())
        .toContain('no code that sends mail')
    })

    it('links to the own client when none is saved', async () => {
      setStatus({}, { hasClient: false })

      const wrapper = await mountPanel('google-gmail')
      const link = wrapper.get('[data-testid="google-detail-action"]')

      expect(wrapper.get('[data-testid="google-detail-state"]').text())
        .toBe('Needs your own Google client')
      expect(link.attributes('href') ?? link.attributes('to'))
        .toBe('/profile/keys?tab=google')
    })
  })

  describe('Google Calendar', () => {
    it('lists the calendar tools and describes the narrow access',
      async () => {
        setStatus({}, {})

        const wrapper = await mountPanel('google-calendar')

        expect(toolNames(wrapper)).toEqual([
          'google__calendar_list_events',
          'google__calendar_free_busy',
          'google__calendar_create_event',
        ])

        await wrapper.get('[data-testid="google-detail-info-toggle"]')
          .trigger('click')

        expect(wrapper.get('[data-testid="google-detail-info"]').text())
          .toContain('adds no guests and sends no email')
      })
  })

  it('shows a leftover own-client connection with Disconnect only',
    async () => {
      setStatus({}, {
        canManage: false,
        redirectUri: null,
        connection: summary({
          clientMode: 'byo',
          capabilities: ['identity', 'gmail-read'],
        }),
      })

      const wrapper = await mountPanel('google-gmail')

      expect(wrapper.get('[data-testid="google-detail-state"]').text())
        .toBe('Not available for this account')
      expect(wrapper.find('[data-testid="google-detail-action"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="google-detail-disconnect"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="google-detail-tools"]').exists())
        .toBe(false)
      expect(wrapper.text()).not.toContain('Tools')
    })

  describe('tools intro', () => {
    async function introOf(
      entryId: string,
      byo: Partial<GoogleByoConnectionStatus> | null,
    ) {
      setStatus({}, byo)

      const wrapper = await mountPanel(entryId)

      return wrapper.get('[data-testid="google-detail-tools-intro"]').text()
    }

    it('names only writes for Drive without the own client', async () => {
      expect(await introOf('google-drive', null)).toBe(
        'Besidka asks before a Google tool runs. Writes ask every time.',
      )
    })

    it('adds found files for the owner of the own client on Drive',
      async () => {
        expect(await introOf('google-drive', {})).toBe(
          'Besidka asks before a Google tool runs. Writes and reads of '
          + 'found files ask every time.',
        )
      })

    it('adds mail on Gmail', async () => {
      expect(await introOf('google-gmail', {})).toBe(
        'Besidka asks before a Google tool runs. Writes and reads of mail '
        + 'ask every time.',
      )
    })

    it('names only writes on Google Calendar', async () => {
      expect(await introOf('google-calendar', {})).toBe(
        'Besidka asks before a Google tool runs. Writes ask every time.',
      )
    })
  })

  it('announces a change in a polite live region', async () => {
    setStatus({ connection: summary() })
    announcement.value = 'Google Drive disconnected.'

    const wrapper = await mountPanel('google-drive')
    const live = wrapper.get('[data-testid="google-detail-live"]')

    expect(live.attributes('aria-live')).toBe('polite')
    expect(live.text()).toBe('Google Drive disconnected.')
  })

  it('disables its actions while busy', async () => {
    setStatus({ connection: summary() })
    isBusy.value = true

    const wrapper = await mountPanel('google-drive')

    expect(wrapper.get('[data-testid="google-detail-disconnect"]')
      .attributes('disabled')).toBeDefined()
  })
})
