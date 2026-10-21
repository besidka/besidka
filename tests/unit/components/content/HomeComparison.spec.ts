import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import HomeComparison from '../../../../app/components/content/HomeComparison.vue'

const mountOptions = {
  global: {
    stubs: {
      LandingComparisonTable: {
        name: 'LandingComparisonTable',
        props: ['caption', 'columns', 'rows'],
        template: '<div />',
      },
    },
  },
}

function mountWithComparison(comparison: Record<string, unknown>) {
  return mountSuspended(HomeComparison, {
    ...mountOptions,
    global: {
      ...mountOptions.global,
      provide: {
        'home:data': { comparison },
      },
    },
  })
}

describe('HomeComparison.vue', () => {
  it('renders nothing without comparison data', async () => {
    const wrapper = await mountSuspended(HomeComparison, mountOptions)

    expect(wrapper.find('p').exists()).toBe(false)
  })

  it('formats an ISO price date as a readable checked date', async () => {
    const wrapper = await mountWithComparison({
      columns: [],
      rows: [],
      priceDate: '2026-10-20',
    })

    expect(
      wrapper.get('[data-testid="landing-comparison-price-date"]').text(),
    ).toBe('Checked 20 October 2026.')
  })

  it('shows a non-ISO price date as written', async () => {
    const wrapper = await mountWithComparison({
      columns: [],
      rows: [],
      priceDate: 'October 2026',
    })

    expect(
      wrapper.get('[data-testid="landing-comparison-price-date"]').text(),
    ).toBe('Checked October 2026.')
  })

  it('renders sources as external links that open safely', async () => {
    const wrapper = await mountWithComparison({
      columns: [],
      rows: [],
      sources: [
        { label: 'ChatGPT Go', url: 'https://example.com/go' },
        { label: 'Claude pricing', url: 'https://example.com/claude' },
      ],
    })

    const links = wrapper.findAll(
      '[data-testid="landing-comparison-sources"] a',
    )

    expect(links).toHaveLength(2)
    expect(links[0]!.attributes('href')).toBe('https://example.com/go')
    expect(links[0]!.attributes('target')).toBe('_blank')
    expect(links[0]!.attributes('rel')).toBe('noopener noreferrer')
    expect(links[0]!.text()).toContain('ChatGPT Go')
  })

  it('renders non-https sources as plain text instead of links', async () => {
    const wrapper = await mountWithComparison({
      columns: [],
      rows: [],
      sources: [
        { label: 'Safe source', url: 'https://example.com/safe' },
        { label: 'Script source', url: 'javascript:alert(1)' },
        { label: 'Plain http source', url: 'http://example.com/plain' },
      ],
    })

    const sources = wrapper.get('[data-testid="landing-comparison-sources"]')
    const links = sources.findAll('a')

    expect(links).toHaveLength(1)
    expect(links[0]!.attributes('href')).toBe('https://example.com/safe')
    expect(sources.text()).toContain('Script source')
    expect(sources.text()).toContain('Plain http source')
    expect(sources.html()).not.toContain('javascript:')
  })

  it('omits the sources line when there are no sources', async () => {
    const wrapper = await mountWithComparison({ columns: [], rows: [] })

    expect(
      wrapper.find('[data-testid="landing-comparison-sources"]').exists(),
    ).toBe(false)
  })
})
