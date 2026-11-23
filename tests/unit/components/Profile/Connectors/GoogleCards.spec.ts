import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import GoogleCards from '../../../../../app/components/Profile/Connectors/GoogleCards.vue'
import { resolveGoogleEntries } from '../../../../../app/utils/google-entries'

enableAutoUnmount(afterEach)

const entries = resolveGoogleEntries({
  status: {
    connection: {
      clientMode: 'besidka',
      status: 'active',
      email: 'person@example.test',
      isWorkspaceAccount: false,
      capabilities: ['identity', 'drive-picked'],
      connectedAt: '2026-11-22T12:00:00.000Z',
    },
    canConnect: true,
    dedicatedClient: true,
    byo: {
      canManage: true,
      redirectUri: null,
      hasClient: false,
      connection: null,
    },
  },
  driveFeature: { enabled: true, active: true },
  isGmailActive: true,
  isCalendarActive: true,
})

const connectableEntries = resolveGoogleEntries({
  status: {
    connection: null,
    canConnect: true,
    dedicatedClient: true,
    byo: {
      canManage: true,
      redirectUri: null,
      hasClient: true,
      connection: {
        clientMode: 'byo',
        status: 'needs_reauth',
        email: 'person@example.test',
        isWorkspaceAccount: false,
        capabilities: ['identity', 'gmail-read'],
        connectedAt: '2026-11-22T12:00:00.000Z',
      },
    },
  },
  driveFeature: { enabled: true, active: true },
  isGmailActive: true,
  isCalendarActive: true,
})

const detailsOnlyEntries = [
  ...resolveGoogleEntries({
    status: {
      connection: null,
      canConnect: true,
      dedicatedClient: true,
      byo: null,
    },
    driveFeature: { enabled: true, active: false },
    isGmailActive: false,
    isCalendarActive: false,
  }),
  ...resolveGoogleEntries({
    status: {
      connection: null,
      canConnect: true,
      dedicatedClient: true,
      byo: {
        canManage: false,
        redirectUri: null,
        hasClient: false,
        connection: {
          clientMode: 'byo',
          status: 'active',
          email: 'person@example.test',
          isWorkspaceAccount: false,
          capabilities: ['identity', 'gmail-read'],
          connectedAt: '2026-11-22T12:00:00.000Z',
        },
      },
    },
    driveFeature: { enabled: false, active: false },
    isGmailActive: true,
    isCalendarActive: true,
  }),
]

async function mountCards(cardEntries = entries) {
  return mountSuspended(GoogleCards, { props: { entries: cardEntries } })
}

describe('Profile/Connectors/GoogleCards', () => {
  it('is a labeled section with a count and a Built in badge per card',
    async () => {
      const wrapper = await mountCards()
      const heading = wrapper.get('h3')

      expect(heading.text()).toContain('Built into Besidka')
      expect(heading.text()).toContain('3')
      expect(wrapper.get('section').attributes('aria-labelledby'))
        .toBe(heading.attributes('id'))
      expect(wrapper.findAll('[data-testid="google-entry-card-badge"]'))
        .toHaveLength(3)
    })

  it('shows Connected for a connected entry and Details when the entry '
    + 'cannot be connected yet', async () => {
    const wrapper = await mountCards()
    const cards = wrapper.findAll('[data-testid="google-entry-card"]')

    expect(cards[0]!.find('[data-testid="google-entry-card-connected"]')
      .exists()).toBe(true)
    expect(cards[0]!.find('[data-testid="google-entry-card-connect"]')
      .exists()).toBe(false)
    expect(cards[1]!.find('[data-testid="google-entry-card-connect"]')
      .exists()).toBe(false)
    expect(cards[1]!.get('[data-testid="google-entry-card-details"]').text())
      .toBe('Details')
    expect(cards[1]!.get('[data-testid="google-entry-card-details"]')
      .classes()).toContain('min-h-11')
  })

  it('shows Connect only for a connect or reconnect action', async () => {
    const wrapper = await mountCards(connectableEntries)
    const buttons = wrapper.findAll('[data-testid="google-entry-card-connect"]')

    expect(buttons).toHaveLength(3)
    expect(buttons.map(button => button.text()))
      .toEqual(['Connect', 'Connect', 'Connect'])
    expect(wrapper.find('[data-testid="google-entry-card-details"]').exists())
      .toBe(false)
    expect(buttons[0]!.classes()).toContain('min-h-11')
  })

  it('shows Details for Off in Labs and Not available for this account',
    async () => {
      const wrapper = await mountCards(detailsOnlyEntries)

      expect(detailsOnlyEntries.map(entry => entry.state))
        .toEqual(['off-in-labs', 'unavailable'])
      expect(wrapper.findAll('[data-testid="google-entry-card-details"]')
        .map(button => button.text())).toEqual(['Details', 'Details'])
      expect(wrapper.find('[data-testid="google-entry-card-connect"]')
        .exists()).toBe(false)
    })

  it('opens the entry from the name, Details and the Connect button',
    async () => {
      const wrapper = await mountCards()
      const cards = wrapper.findAll('[data-testid="google-entry-card"]')

      await cards[0]!.get('[data-testid="google-entry-card-open"]')
        .trigger('click')
      await cards[2]!.get('[data-testid="google-entry-card-details"]')
        .trigger('click')

      const connectWrapper = await mountCards(connectableEntries)

      await connectWrapper.get('[data-testid="google-entry-card-connect"]')
        .trigger('click')

      expect(wrapper.emitted('open')).toEqual([
        ['google-drive'],
        ['google-calendar'],
      ])
      expect(connectWrapper.emitted('open')).toEqual([['google-drive']])
    })
})
