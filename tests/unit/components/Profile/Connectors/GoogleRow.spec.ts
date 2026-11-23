import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import GoogleRow from '../../../../../app/components/Profile/Connectors/GoogleRow.vue'
import { resolveGoogleEntries } from '../../../../../app/utils/google-entries'
import type { GoogleEntry } from '../../../../../app/utils/google-entries'
import type { GoogleConnectionSummary } from '#shared/utils/google-connections'

enableAutoUnmount(afterEach)

const OPEN = '[data-testid="google-entry-row-open"]'
const ACTION = '[data-testid="google-entry-row-action"]'
const STATE = '[data-testid="google-entry-row-state"]'

function buildEntry(
  entryId: GoogleEntry['id'],
  connection: GoogleConnectionSummary | null = null,
  isDriveActive = true,
): GoogleEntry {
  const entries = resolveGoogleEntries({
    status: {
      connection: connection?.clientMode === 'besidka' ? connection : null,
      canConnect: true,
      dedicatedClient: true,
      byo: {
        canManage: true,
        redirectUri: 'https://besidka.example/api/v1/google/byo/callback',
        hasClient: true,
        connection: connection?.clientMode === 'byo' ? connection : null,
      },
    },
    driveFeature: { enabled: true, active: isDriveActive },
    isGmailActive: true,
    isCalendarActive: true,
  })

  return entries.find(entry => entry.id === entryId)!
}

async function mountRow(
  entry: GoogleEntry,
  props: Record<string, unknown> = {},
) {
  return mountSuspended(GoogleRow, { props: { entry, ...props } })
}

describe('Profile/Connectors/GoogleRow', () => {
  it('shows the logo, the name, the Built in badge, one state line and '
    + 'one action', async () => {
    const wrapper = await mountRow(buildEntry('google-gmail'))

    expect(wrapper.get(OPEN).text()).toBe('Gmail')
    expect(wrapper.get('[data-testid="google-entry-row-badge"]').text())
      .toBe('Built in')
    expect(wrapper.get(STATE).text()).toBe('Not connected')
    expect(wrapper.findAll(ACTION)).toHaveLength(1)
    expect(wrapper.get(ACTION).text()).toBe('Connect Gmail')
    expect(wrapper.get(ACTION).classes()).toEqual(
      expect.arrayContaining(['btn', 'min-h-11']),
    )
    expect(wrapper.html()).toContain('logos:google-gmail')
    expect(wrapper.find('[data-testid="connector-row-remove"]').exists())
      .toBe(false)
  })

  it('shows the Drive description with the Sheets and read-only promise',
    async () => {
      const wrapper = await mountRow(buildEntry('google-drive'))
      const description = wrapper
        .get('[data-testid="google-entry-row-description"]').text()

      expect(description).toContain('Files you pick.')
      expect(description).toContain('Docs, Sheets and Slides')
      expect(description).toContain('never edits Google files')
    })

  it('opens the panel from the name', async () => {
    const wrapper = await mountRow(buildEntry('google-calendar'))

    await wrapper.get(OPEN).trigger('click')

    expect(wrapper.emitted('open')).toEqual([['google-calendar']])
  })

  it('emits the entry from its action button', async () => {
    const entry = buildEntry('google-drive')
    const wrapper = await mountRow(entry)

    await wrapper.get(ACTION).trigger('click')

    expect(wrapper.emitted('action')).toEqual([[entry]])
  })

  it('shows the email and a Disconnect action when connected', async () => {
    const wrapper = await mountRow(buildEntry('google-drive', {
      clientMode: 'besidka',
      status: 'active',
      email: 'person@example.test',
      isWorkspaceAccount: false,
      capabilities: ['identity', 'drive-picked'],
      connectedAt: '2026-11-22T12:00:00.000Z',
    }))

    expect(wrapper.get(STATE).text()).toBe('person@example.test')
    expect(wrapper.get(ACTION).text()).toBe('Disconnect')
    expect(wrapper.get(ACTION).classes()).not.toContain('btn-primary')
    expect(wrapper.get(ACTION).attributes('aria-label'))
      .toBe('Disconnect, Google Drive')
  })

  it('links to Labs while the service is off there', async () => {
    const wrapper = await mountRow(
      buildEntry('google-drive', null, false),
    )

    expect(wrapper.get(STATE).text()).toBe('Off in Labs')
    expect(wrapper.get(ACTION).text()).toBe('Open Labs')

    const link = wrapper.get(ACTION)

    expect(link.attributes('href') ?? link.attributes('to'))
      .toBe('/profile/labs')
  })

  it('disables the action and marks it busy while busy', async () => {
    const wrapper = await mountRow(
      buildEntry('google-gmail'),
      { isBusy: true },
    )

    expect(wrapper.get(ACTION).attributes('disabled')).toBeDefined()
    expect(wrapper.get(ACTION).attributes('aria-busy')).toBe('true')
  })

  it('marks itself selected while its panel is open', async () => {
    const wrapper = await mountRow(
      buildEntry('google-gmail'),
      { isSelected: true },
    )

    expect(wrapper.classes()).toContain('bg-base-200')
  })
})
