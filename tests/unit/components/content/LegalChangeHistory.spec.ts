import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { LEGAL_CHANGE_HISTORY_EMPTY_TEXT } from '#shared/utils/legal-change-history'
import LegalChangeHistory from '../../../../app/components/content/LegalChangeHistory.vue'

describe('LegalChangeHistory.vue', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists the first notice for the privacy policy with its dates', async () => {
    const wrapper = await mountSuspended(LegalChangeHistory, {
      props: { document: 'privacy-policy' },
    })
    const section = wrapper.find(
      '[data-testid="legal-change-history-2026-11-legal-notices"]',
    )

    expect(section.exists()).toBe(true)
    expect(section.find('strong').text()).toBe(
      'Announced 31 October 2026, in effect from 1 December 2026',
    )
    expect(section.findAll('time').map((time) => {
      return time.attributes('datetime')
    })).toEqual(['2026-10-31T06:00:00Z', '2026-12-01'])
    expect(section.findAll('li').length).toBeGreaterThanOrEqual(3)
    expect(wrapper.text()).toContain('Profile → Connected apps')
  })

  it('says so when the document has no material change yet', async () => {
    const wrapper = await mountSuspended(LegalChangeHistory, {
      props: { document: 'cookie-policy' },
    })

    expect(wrapper.find('[data-testid="legal-change-history-empty"]').text())
      .toBe(LEGAL_CHANGE_HISTORY_EMPTY_TEXT)
    expect(wrapper.findAll('li')).toHaveLength(0)
  })

  it('shows nothing from a notice before it is published', async () => {
    vi.setSystemTime(new Date('2026-10-30T00:00:00Z'))

    const wrapper = await mountSuspended(LegalChangeHistory, {
      props: { document: 'privacy-policy' },
    })

    expect(wrapper.find('[data-testid="legal-change-history-empty"]').exists())
      .toBe(true)
  })
})
