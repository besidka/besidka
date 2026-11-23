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
import {
  GOOGLE_DRIVE_WRITE_ACCESS_NOTE,
  GOOGLE_DRIVE_WRITE_SCOPE_NOTE,
} from '#shared/utils/google-drive-write'
import { GOOGLE_TOOL_CATALOG } from '#shared/utils/google-tool-catalog'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  disconnect: vi.fn(),
  addDriveSearchAccess: vi.fn(),
  addDriveWriteAccess: vi.fn(),
  refresh: vi.fn(),
  refreshPermissions: vi.fn(),
  savePermission: vi.fn(),
}))

const statusData = ref<GoogleConnectionStatusResponse | null>(null)
const loadStatus = ref<string>('success')
const announcement = ref<string>('')
const isBusy = ref<boolean>(false)

interface PermissionRow {
  name: string
  service: string
  mode: 'blocked' | 'ask' | 'allow'
}

const permissionTools = ref<PermissionRow[]>([])
const permissionStatus = ref<string>('success')
const permissionError = ref<unknown>(null)
const permissionUnavailable = ref<boolean>(false)
const permissionAnnouncement = ref<string>('')

mockNuxtImport('useGoogleToolPermissions', () => {
  return () => ({
    tools: computed(() => permissionTools.value),
    status: permissionStatus,
    error: permissionError,
    refresh: mocks.refreshPermissions,
    isSaving: ref(false),
    isUnavailable: permissionUnavailable,
    announcement: permissionAnnouncement,
    save: mocks.savePermission,
  })
})

function seedPermissions(
  modes: Partial<Record<string, 'blocked' | 'ask' | 'allow'>> = {},
) {
  permissionTools.value = GOOGLE_TOOL_CATALOG.map((tool) => {
    return {
      name: tool.name,
      service: tool.service,
      mode: modes[tool.name] ?? 'ask',
    }
  })
}

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
    addDriveWriteAccess: mocks.addDriveWriteAccess,
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

type PanelWrapper = Awaited<ReturnType<typeof mountPanel>>

function toolNames(wrapper: PanelWrapper) {
  return wrapper.findAll('[data-testid="tool-permissions-row"]')
    .map(tool => tool.attributes('data-tool-name'))
}

function toolRow(wrapper: PanelWrapper, name: string) {
  return wrapper.get(
    `[data-testid="tool-permissions-row"][data-tool-name="${name}"]`,
  )
}

function option(wrapper: PanelWrapper, name: string, mode: string) {
  return toolRow(wrapper, name)
    .get(`[data-testid="tool-permission-option-${mode}"]`)
}

function hintOf(wrapper: PanelWrapper, name: string, mode: string) {
  return option(wrapper, name, mode).element.parentElement
    ?.getAttribute('data-tip')
}

describe('Profile/Connectors/GoogleDetailPanel', () => {
  beforeEach(() => {
    statusData.value = null
    loadStatus.value = 'success'
    announcement.value = ''
    isBusy.value = false

    permissionStatus.value = 'success'
    permissionError.value = null
    permissionUnavailable.value = false
    permissionAnnouncement.value = ''
    seedPermissions()

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

    it('lists the three picked-file tools and nothing else for a user '
      + 'without the own client', async () => {
      setStatus()

      const wrapper = await mountPanel('google-drive')

      expect(toolNames(wrapper)).toEqual([
        'google__drive_list_picked',
        'google__drive_read_file',
        'google__drive_save_file',
      ])
      expect(wrapper.get('[data-testid="tool-permissions-group-read"]')
        .text()).toContain('Read')
      expect(wrapper.get('[data-testid="tool-permissions-group-write"]')
        .text()).toContain('Write')
      expect(wrapper.find('[data-testid="google-detail-own-client"]').exists())
        .toBe(false)
    })

    it('gives each picked-file tool a radio group with Blocked and Needs '
      + 'approval and Always allow off', async () => {
      setStatus()

      const wrapper = await mountPanel('google-drive')
      const groups = toolRow(wrapper, 'google__drive_list_picked')
        .findAll('[role="radiogroup"]')

      expect(groups).toHaveLength(1)
      expect(groups[0]!.attributes('aria-label'))
        .toBe('Permission for List the files you picked')
      expect(option(wrapper, 'google__drive_list_picked', 'ask')
        .attributes('aria-checked')).toBe('true')
      expect(option(wrapper, 'google__drive_list_picked', 'blocked')
        .attributes('aria-checked')).toBe('false')
      expect(option(wrapper, 'google__drive_list_picked', 'allow')
        .attributes('aria-disabled')).toBe('true')
    })

    it('says why Always allow is off for the tools of Besidka\'s client',
      async () => {
        setStatus()

        const wrapper = await mountPanel('google-drive')
        const reason = 'Always allow — Needs approval: this connection goes '
          + 'through Google\'s app review.'

        expect(hintOf(wrapper, 'google__drive_list_picked', 'allow'))
          .toBe(reason)
        expect(hintOf(wrapper, 'google__drive_read_file', 'allow'))
          .toBe(reason)
        expect(hintOf(wrapper, 'google__drive_save_file', 'allow'))
          .toBe(reason)
      })

    it('makes Always allow selectable for the tools of the own client',
      async () => {
        setStatus({}, {})

        const wrapper = await mountPanel('google-gmail')

        for (const name of [
          'google__gmail_search',
          'google__gmail_read_thread',
          'google__gmail_create_draft',
        ]) {
          expect(option(wrapper, name, 'allow').attributes('aria-disabled'))
            .toBe('false')
          expect(hintOf(wrapper, name, 'allow'))
            .toBe('Always allow — runs without asking')
        }
      })

    it('keeps Always allow disabled on the Besidka tools next to own-client '
      + 'tools in the same group', async () => {
      setStatus({}, {})

      const wrapper = await mountPanel('google-drive')

      expect(option(wrapper, 'google__drive_search', 'allow')
        .attributes('aria-disabled')).toBe('false')
      expect(option(wrapper, 'google__drive_create_folder', 'allow')
        .attributes('aria-disabled')).toBe('false')
      expect(option(wrapper, 'google__drive_read_file', 'allow')
        .attributes('aria-disabled')).toBe('true')
      expect(option(wrapper, 'google__drive_save_file', 'allow')
        .attributes('aria-disabled')).toBe('true')
    })

    it('saves Always allow from the control of an own-client tool',
      async () => {
        setStatus({}, {})

        const wrapper = await mountPanel('google-gmail')

        await option(wrapper, 'google__gmail_search', 'allow')
          .trigger('click')

        expect(mocks.savePermission).toHaveBeenCalledWith(
          { tool: 'google__gmail_search' },
          'allow',
        )
      })

    it('shows a stored Always allow as checked', async () => {
      seedPermissions({ google__calendar_create_event: 'allow' })
      setStatus({}, {})

      const wrapper = await mountPanel('google-calendar')

      expect(option(wrapper, 'google__calendar_create_event', 'allow')
        .attributes('aria-checked')).toBe('true')
      expect(option(wrapper, 'google__calendar_create_event', 'ask')
        .attributes('aria-checked')).toBe('false')
    })

    it('warns under the read group of Gmail that results hold text written '
      + 'by other people, and under the once-only read what it opens',
    async () => {
      setStatus({}, {})

      const wrapper = await mountPanel('google-gmail')
      const warning = wrapper.get(
        '[data-testid="tool-permissions-group-warning-read"]',
      ).text()

      expect(warning).toContain(
        'Always allow lets the model read this without asking, including '
        + 'text written by other people.',
      )
      expect(warning).toContain(
        'Always allow lets the model open whole email threads without '
        + 'asking, including everything other people wrote in them.',
      )
    })

    it('warns under the Gmail write group that drafts are created without '
      + 'asking and that Besidka never sends mail', async () => {
      setStatus({}, {})

      const wrapper = await mountPanel('google-gmail')

      expect(wrapper.get(
        '[data-testid="tool-permissions-group-warning-write"]',
      ).text()).toBe(
        'Always allow lets the model create drafts without asking. '
        + 'A draft can be addressed to anyone, and drafts are never sent. '
        + 'Google\'s permission for drafts also allows sending mail; '
        + 'Besidka has no code that sends mail.',
      )
    })

    it('warns under the Calendar write group that events are created '
      + 'without asking', async () => {
      setStatus({}, {})

      const wrapper = await mountPanel('google-calendar')

      expect(wrapper.get(
        '[data-testid="tool-permissions-group-warning-write"]',
      ).text()).toBe(
        'Always allow lets the model create events without asking. '
        + 'Events may carry text from other content (such as an email) into '
        + 'your calendar, where people who can see your calendar can read it.',
      )
    })

    it('warns under the Drive write group about creating, renaming and '
      + 'moving, and says Besidka has no code that deletes or shares',
    async () => {
      setStatus({}, {})

      const wrapper = await mountPanel('google-drive')

      expect(wrapper.get(
        '[data-testid="tool-permissions-group-warning-write"]',
      ).text()).toBe(
        'Always allow lets the model create files and folders, and rename '
        + 'and move Drive items, without asking. The model writes the '
        + 'content of a new file, and it may carry text from other content '
        + '(such as an email) into your Drive. A rename of a file that is '
        + 'shared with others shows the new name to them. Google\'s '
        + 'permission for Drive also allows deleting and sharing; Besidka '
        + 'has no code that deletes or shares.',
      )
    })

    it('shows no warning for a user without the own client', async () => {
      setStatus()

      const wrapper = await mountPanel('google-drive')

      expect(wrapper.find(
        '[data-testid="tool-permissions-group-warning-read"]',
      ).exists()).toBe(false)
      expect(wrapper.find(
        '[data-testid="tool-permissions-group-warning-write"]',
      ).exists()).toBe(false)
    })

    it('shows Custom on a group whose tools differ and offers Always allow '
      + 'in its select', async () => {
      seedPermissions({ google__gmail_search: 'allow' })
      setStatus({}, {})

      const wrapper = await mountPanel('google-gmail')
      const select = wrapper.get(
        '[data-testid="tool-permissions-group-select-read"]',
      )

      expect((select.element as HTMLSelectElement).value).toBe('custom')
      expect(select.findAll('option').map(item => item.attributes('value')))
        .toEqual(['custom', 'blocked', 'ask', 'allow'])
    })

    it('sets Always allow for a whole group from its select', async () => {
      setStatus({}, {})

      const wrapper = await mountPanel('google-calendar')

      await wrapper.get('[data-testid="tool-permissions-group-select-read"]')
        .setValue('allow')
      await flushPromises()

      expect(mocks.savePermission.mock.calls).toEqual([
        [{ service: 'calendar', kind: 'read' }, 'allow'],
      ])
    })

    it('offers Always allow in a Drive group select only for the own client '
      + 'tools it holds', async () => {
      setStatus()

      const wrapper = await mountPanel('google-drive')
      const select = wrapper.get(
        '[data-testid="tool-permissions-group-select-read"]',
      )

      expect(select.findAll('option').map(item => item.attributes('value')))
        .toEqual(['blocked', 'ask'])
    })

    it('blocks a tool from its control and never saves Always allow on a '
      + 'tool of Besidka\'s client', async () => {
      setStatus()

      const wrapper = await mountPanel('google-drive')

      await option(wrapper, 'google__drive_list_picked', 'blocked')
        .trigger('click')
      await option(wrapper, 'google__drive_list_picked', 'allow')
        .trigger('click')

      expect(mocks.savePermission).toHaveBeenCalledTimes(1)
      expect(mocks.savePermission).toHaveBeenCalledWith(
        { tool: 'google__drive_list_picked' },
        'blocked',
      )
    })

    it('shows a stored Block as checked', async () => {
      seedPermissions({ google__drive_save_file: 'blocked' })
      setStatus()

      const wrapper = await mountPanel('google-drive')

      expect(option(wrapper, 'google__drive_save_file', 'blocked')
        .attributes('aria-checked')).toBe('true')
      expect(option(wrapper, 'google__drive_save_file', 'ask')
        .attributes('aria-checked')).toBe('false')
    })

    it('sets every tool of a group from its select and offers no Always '
      + 'allow there when none of its tools can take it', async () => {
      setStatus()

      const wrapper = await mountPanel('google-drive')
      const select = wrapper.get(
        '[data-testid="tool-permissions-group-select-read"]',
      )

      expect(select.findAll('option').map(item => item.attributes('value')))
        .toEqual(['blocked', 'ask'])

      await select.setValue('blocked')
      await flushPromises()

      expect(mocks.savePermission.mock.calls).toEqual([
        [{ service: 'drive', kind: 'read' }, 'blocked'],
      ])
    })

    it('keeps one tab stop on the checked option of each control', async () => {
      setStatus()

      const wrapper = await mountPanel('google-drive')

      expect(option(wrapper, 'google__drive_list_picked', 'allow')
        .attributes('tabindex')).toBe('-1')
      expect(option(wrapper, 'google__drive_list_picked', 'ask')
        .attributes('tabindex')).toBe('0')
      expect(option(wrapper, 'google__drive_list_picked', 'blocked')
        .attributes('tabindex')).toBe('-1')
    })

    it('shows only the tools the server lists for the account', async () => {
      permissionTools.value = permissionTools.value.filter((tool) => {
        return tool.name !== 'google__drive_save_file'
      })
      setStatus()

      const wrapper = await mountPanel('google-drive')

      expect(toolNames(wrapper)).toEqual([
        'google__drive_list_picked',
        'google__drive_read_file',
      ])
      expect(wrapper.find('[data-testid="tool-permissions-group-write"]')
        .exists()).toBe(false)
    })

    it('shows a skeleton while the permissions load and a retry when they '
      + 'fail', async () => {
      setStatus()
      permissionTools.value = []
      permissionStatus.value = 'pending'

      const loading = await mountPanel('google-drive')

      expect(loading.find('[data-testid="google-detail-tools"] '
        + '[data-testid="side-panel-skeleton"]').exists()).toBe(true)

      permissionStatus.value = 'error'
      permissionError.value = new Error('failed')

      const failed = await mountPanel('google-drive')

      await failed.get('[data-testid="google-detail-tools-retry"]')
        .trigger('click')

      expect(failed.get('[data-testid="google-detail-tools-error"]').text())
        .toContain('did not load')
      expect(mocks.refreshPermissions).toHaveBeenCalled()
    })

    it('hides the tools section when the server lists none of this '
      + 'service\'s tools', async () => {
      permissionTools.value = permissionTools.value.filter((tool) => {
        return tool.service !== 'gmail'
      })
      setStatus({}, {})

      const wrapper = await mountPanel('google-gmail')

      expect(wrapper.find('[data-testid="google-detail-tools"]').exists())
        .toBe(false)
      expect(wrapper.text()).not.toContain('never offered to the model')
    })

    it('hides the tools when the account reaches none', async () => {
      permissionUnavailable.value = true
      setStatus()

      const wrapper = await mountPanel('google-drive')

      expect(wrapper.find('[data-testid="google-detail-tools"]').exists())
        .toBe(false)
    })

    it('announces a saved change in a polite live region', async () => {
      permissionAnnouncement.value = 'Search your Gmail: Blocked.'
      setStatus({}, {})

      const wrapper = await mountPanel('google-gmail')
      const live = wrapper.get('[data-testid="google-detail-permission-live"]')

      expect(live.attributes('aria-live')).toBe('polite')
      expect(live.text()).toBe('Search your Gmail: Blocked.')
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
          'google__drive_list_folder',
          'google__drive_save_file',
          'google__drive_create_folder',
          'google__drive_create_file',
          'google__drive_rename',
          'google__drive_move',
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

    it('says in the info note that Besidka never changes a Google file '
      + 'without Change files access', async () => {
      setStatus()

      const wrapper = await mountPanel('google-drive')

      await wrapper.get('[data-testid="google-detail-info-toggle"]')
        .trigger('click')

      const text = wrapper.get('[data-testid="google-detail-info"]').text()

      expect(text).toContain('Without Change files access it never changes '
        + 'a Google file.')
      expect(text).not.toContain('One exception')
    })

    it('adds the folder exception to the info note once Change files '
      + 'access is granted', async () => {
      setStatus({}, {
        connection: summary({
          clientMode: 'byo',
          capabilities: ['identity', 'drive-read', 'drive-write'],
        }),
      })

      const wrapper = await mountPanel('google-drive')

      await wrapper.get('[data-testid="google-detail-info-toggle"]')
        .trigger('click')

      const text = wrapper.get('[data-testid="google-detail-info"]').text()

      expect(text).toContain('Without Change files access it never changes '
        + 'a Google file.')
      expect(text).toContain('One exception')
      expect(text).toContain('create a file or a folder, and rename or move '
        + 'files and folders you own, in your own My Drive after you approve '
        + 'each one, unless you set the tool to Always allow. It cannot '
        + 'delete anything or change who can see a file.')
      expect(text).not.toContain('will be added later')
    })

    describe('Change files access', () => {
      function ownerWith(capabilities: GoogleConnectionSummary['capabilities']) {
        setStatus({}, {
          connection: summary({ clientMode: 'byo', capabilities }),
        })
      }

      it('offers the checkbox and Add access when read is granted and '
        + 'write is missing', async () => {
        ownerWith(['identity', 'drive-read'])

        const wrapper = await mountPanel('google-drive')
        const checkbox = wrapper.get(
          '[data-testid="google-detail-drive-write-checkbox"]',
        )
        const button = wrapper.get(
          '[data-testid="google-detail-drive-write-add-access"]',
        )
        const section = wrapper.get(
          '[data-testid="google-detail-drive-write"]',
        ).text()

        expect(section).toContain('Change files in Google Drive')
        expect(section).toContain(GOOGLE_DRIVE_WRITE_ACCESS_NOTE)
        expect(section).toContain(GOOGLE_DRIVE_WRITE_SCOPE_NOTE)
        expect(checkbox.attributes('disabled')).toBeUndefined()
        expect((checkbox.element as HTMLInputElement).checked).toBe(false)
        expect(button.attributes('disabled')).toBeDefined()

        await checkbox.setValue(true)

        expect(button.attributes('disabled')).toBeUndefined()

        await button.trigger('click')

        expect(mocks.addDriveWriteAccess).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'google-drive' }),
        )
      })

      it('disables both while another request is running', async () => {
        ownerWith(['identity', 'drive-read'])
        isBusy.value = true

        const wrapper = await mountPanel('google-drive')

        expect(wrapper.get(
          '[data-testid="google-detail-drive-write-checkbox"]',
        ).attributes('disabled')).toBeDefined()
        expect(wrapper.get(
          '[data-testid="google-detail-drive-write-add-access"]',
        ).attributes('disabled')).toBeDefined()
      })

      it('shows a read-only line and no checkbox once granted', async () => {
        ownerWith(['identity', 'drive-read', 'drive-write'])

        const wrapper = await mountPanel('google-drive')

        expect(wrapper.get(
          '[data-testid="google-detail-drive-write-granted"]',
        ).text()).toBe('Change files access granted')
        expect(wrapper.find(
          '[data-testid="google-detail-drive-write-checkbox"]',
        ).exists()).toBe(false)
        expect(wrapper.find(
          '[data-testid="google-detail-drive-write-add-access"]',
        ).exists()).toBe(false)
      })

      it('shows a disabled hint while Drive read access is missing',
        async () => {
          ownerWith(['identity', 'gmail-read'])

          const wrapper = await mountPanel('google-drive')

          expect(wrapper.get(
            '[data-testid="google-detail-drive-write-needs-read"]',
          ).text()).toBe('Needs Drive read access first')
          expect(wrapper.get(
            '[data-testid="google-detail-drive-write-checkbox"]',
          ).attributes('disabled')).toBeDefined()
          expect(wrapper.get(
            '[data-testid="google-detail-drive-write-add-access"]',
          ).attributes('disabled')).toBeDefined()
          expect(wrapper.find(
            '[data-testid="google-detail-own-client-add-access"]',
          ).exists()).toBe(true)
        })

      it('shows nothing to a user without the own client gate', async () => {
        setStatus({}, { canManage: false })

        const wrapper = await mountPanel('google-drive')

        expect(wrapper.find('[data-testid="google-detail-drive-write"]')
          .exists()).toBe(false)
      })

      it('shows nothing without a saved client', async () => {
        setStatus({}, { hasClient: false })

        const wrapper = await mountPanel('google-drive')

        expect(wrapper.find('[data-testid="google-detail-drive-write"]')
          .exists()).toBe(false)
      })

      it('is not on the Gmail panel', async () => {
        ownerWith(['identity', 'drive-read', 'gmail-read'])

        const wrapper = await mountPanel('google-gmail')

        expect(wrapper.find('[data-testid="google-detail-drive-write"]')
          .exists()).toBe(false)
      })
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

      expect(wrapper.get('[data-testid="tool-permissions-group-read"]')
        .text()).toContain('Read')
      expect(wrapper.get('[data-testid="tool-permissions-group-write"]')
        .text()).toContain('Write')
      expect(toolNames(wrapper)).toEqual([
        'google__gmail_search',
        'google__gmail_read_thread',
        'google__gmail_create_draft',
      ])
      expect(['google__gmail_search', 'google__gmail_read_thread',
        'google__gmail_create_draft'].map((name) => {
        return hintOf(wrapper, name, 'allow')
      })).toEqual([
        'Always allow — runs without asking',
        'Always allow — runs without asking',
        'Always allow — runs without asking',
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

    const APP_REVIEW_SENTENCE = 'Tools that use Besidka\'s own Google app '
      + 'always ask: a read can be allowed for one chat from its approval, '
      + 'and saving a file asks every time.'

    it('says Besidka\'s own Google app always asks for Drive without the '
      + 'own client', async () => {
      expect(await introOf('google-drive', null)).toBe(
        `Besidka asks before a Google tool runs. ${APP_REVIEW_SENTENCE}`,
      )
    })

    it('adds the Always allow option for the owner of the own client on '
      + 'Drive', async () => {
      expect(await introOf('google-drive', {})).toBe(
        'Besidka asks before a Google tool runs, unless you set it to '
        + `Always allow. ${APP_REVIEW_SENTENCE}`,
      )
    })

    it('names the Always allow option on Gmail and no app review', async () => {
      expect(await introOf('google-gmail', {})).toBe(
        'Besidka asks before a Google tool runs, unless you set it to '
        + 'Always allow.',
      )
    })

    it('names the Always allow option on Google Calendar', async () => {
      expect(await introOf('google-calendar', {})).toBe(
        'Besidka asks before a Google tool runs, unless you set it to '
        + 'Always allow.',
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
