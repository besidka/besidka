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

async function mountCards() {
  return mountSuspended(GoogleCards, { props: { entries } })
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

  it('shows Connected for a connected entry and Connect for the rest',
    async () => {
      const wrapper = await mountCards()
      const cards = wrapper.findAll('[data-testid="google-entry-card"]')

      expect(cards[0]!.find('[data-testid="google-entry-card-connected"]')
        .exists()).toBe(true)
      expect(cards[0]!.find('[data-testid="google-entry-card-connect"]')
        .exists()).toBe(false)
      expect(cards[1]!.get('[data-testid="google-entry-card-connect"]')
        .classes()).toContain('min-h-11')
    })

  it('opens the entry from the name and the Connect button', async () => {
    const wrapper = await mountCards()
    const cards = wrapper.findAll('[data-testid="google-entry-card"]')

    await cards[0]!.get('[data-testid="google-entry-card-open"]')
      .trigger('click')
    await cards[2]!.get('[data-testid="google-entry-card-connect"]')
      .trigger('click')

    expect(wrapper.emitted('open')).toEqual([
      ['google-drive'],
      ['google-calendar'],
    ])
  })
})
