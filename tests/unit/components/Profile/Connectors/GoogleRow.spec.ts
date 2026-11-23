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

  it('shows the Drive description for both client modes', async () => {
    const wrapper = await mountRow(buildEntry('google-drive'))
    const description = wrapper
      .get('[data-testid="google-entry-row-description"]').text()

    expect(description).toContain('Files you pick.')
    expect(description).toContain('Docs, Sheets and Slides')
    expect(description).toContain('only reads the files you pick')
    expect(description).toContain('Besidka\'s built-in Google connection')
    expect(description).toContain('saves a file only after you approve it')
    expect(description).toContain('your own Google client')
    expect(description).toContain('Change files access')
    expect(description).toContain('create folders when you approve')
    expect(description).not.toContain('never edits Google files')
  })

  it('opens the panel from the name', async () => {
    const wrapper = await mountRow(buildEntry('google-calendar'))

    await wrapper.get(OPEN).trigger('click')

    expect(wrapper.emitted('open')).toEqual([['google-calendar']])
  })

  it('has the title as the only open control and stretches it over the row',
    async () => {
      const wrapper = await mountRow(buildEntry('google-gmail'))
      const controls = wrapper.findAll('button, a')

      expect(wrapper.findAll(OPEN)).toHaveLength(1)
      expect(controls).toHaveLength(2)
      expect(wrapper.classes()).toContain('relative')
      expect(wrapper.get(OPEN).classes()).toEqual(
        expect.arrayContaining([
          'after:absolute',
          'after:inset-0',
          'cursor-pointer',
        ]),
      )
    })

  it('keeps the action button above the stretched title', async () => {
    const entry = buildEntry('google-gmail')
    const wrapper = await mountRow(entry)

    expect(wrapper.get(ACTION).classes())
      .toEqual(expect.arrayContaining(['relative', 'z-10']))

    await wrapper.get(ACTION).trigger('click')

    expect(wrapper.emitted('action')).toEqual([[entry]])
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('keeps the Labs link above the stretched title', async () => {
    const wrapper = await mountRow(
      buildEntry('google-drive', null, false),
    )

    expect(wrapper.get(ACTION).classes())
      .toEqual(expect.arrayContaining(['relative', 'z-10']))
  })

  it('shows a hover state until the row is selected', async () => {
    const idle = await mountRow(buildEntry('google-gmail'))
    const selected = await mountRow(
      buildEntry('google-gmail'),
      { isSelected: true },
    )

    expect(idle.classes()).toContain('hover:bg-base-200/60')
    expect(idle.classes()).not.toContain('bg-base-200')
    expect(selected.classes()).toContain('bg-base-200')
    expect(selected.classes()).not.toContain('hover:bg-base-200/60')
  })

  it('emits the entry from its action button', async () => {
    const entry = buildEntry('google-drive')
    const wrapper = await mountRow(entry)

    await wrapper.get(ACTION).trigger('click')

    expect(wrapper.emitted('action')).toEqual([[entry]])
  })

  it('shows the email and no row action when connected', async () => {
    const entry = buildEntry('google-drive', {
      clientMode: 'besidka',
      status: 'active',
      email: 'person@example.test',
      isWorkspaceAccount: false,
      capabilities: ['identity', 'drive-picked'],
      connectedAt: '2026-11-22T12:00:00.000Z',
    })
    const wrapper = await mountRow(entry)

    expect(entry.action).toBe('disconnect')
    expect(wrapper.get(STATE).text()).toBe('person@example.test')
    expect(wrapper.find(ACTION).exists()).toBe(false)
    expect(wrapper.findAll('button, a')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('Disconnect')
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
