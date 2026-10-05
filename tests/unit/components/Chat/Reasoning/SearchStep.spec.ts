import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import SearchStep from '../../../../../app/components/Chat/Reasoning/SearchStep.vue'
import type {
  SearchStepData,
} from '../../../../../app/types/search-step.d'

const mocks = vi.hoisted(() => ({
  openResearchLink: vi.fn(),
}))

mockNuxtImport('useResearchLink', () => {
  return () => {
    return { openResearchLink: mocks.openResearchLink }
  }
})

function createData(overrides: Partial<SearchStepData> = {}): SearchStepData {
  return {
    toolName: 'web_search_brave',
    state: 'done',
    query: 'poland election results',
    freshness: undefined,
    results: [],
    hasOutput: true,
    errorReason: '',
    ...overrides,
  }
}

async function mountStep(
  data: SearchStepData,
  options: {
    title?: string
    pending?: boolean
    searchedAt?: string | number | Date
  } = {},
): Promise<VueWrapper> {
  return await mountSuspended(SearchStep, {
    props: {
      data,
      title: options.title ?? 'Searched with Brave',
      pending: options.pending ?? false,
      searchedAt: options.searchedAt,
    },
  })
}

function trigger(wrapper: VueWrapper) {
  return wrapper.get('[data-testid="reasoning-search-step-trigger"]')
}

describe('Chat/Reasoning/SearchStep', () => {
  beforeEach(() => {
    mocks.openResearchLink.mockReset()
  })

  it('shows the label, the quoted query, the freshness badge and the '
    + 'result count when collapsed', async () => {
    const wrapper = await mountStep(createData({
      freshness: 'week',
      results: [
        { title: 'One', url: 'https://example.com/one' },
        { title: 'Two', url: 'https://example.com/two' },
      ],
    }))

    expect(wrapper.get('[data-testid="reasoning-search-step-title"]').text())
      .toBe('Searched with Brave')
    expect(wrapper.get('[data-testid="reasoning-search-step-query"]').text())
      .toBe('“poland election results”')
    expect(
      wrapper.get('[data-testid="reasoning-search-step-freshness"]').text(),
    ).toBe('Last 7 days')
    expect(wrapper.get('[data-testid="reasoning-search-step-count"]').text())
      .toBe('2 results')
    expect(wrapper.find('[data-testid="reasoning-search-step-results"]').exists())
      .toBe(false)
  })

  it('explains the freshness cutoff relative to when the search ran',
    async () => {
      const searchedAt = '2026-10-05T12:00:00.000Z'
      const cutoff = new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(new Date('2026-09-28T12:00:00.000Z'))
      const wrapper = await mountStep(
        createData({ freshness: 'week' }),
        { searchedAt },
      )
      const tooltip = wrapper.get(
        '[data-testid="reasoning-search-step-freshness-tooltip"]',
      )

      expect(tooltip.attributes('data-tip'))
        .toBe(`Only pages published since ${cutoff}`)
      expect(tooltip.attributes('aria-label'))
        .toBe(`Last 7 days. Only pages published since ${cutoff}`)
      expect(tooltip.classes()).toContain('tooltip')
      expect(
        tooltip.get('[data-testid="reasoning-search-step-freshness"]').text(),
      ).toBe('Last 7 days')
    })

  it('describes the window without a date when the search time is '
    + 'unknown', async () => {
    const wrapper = await mountStep(createData({ freshness: 'year' }))
    const tooltip = wrapper.get(
      '[data-testid="reasoning-search-step-freshness-tooltip"]',
    )

    expect(tooltip.attributes('data-tip'))
      .toBe('Only pages published in the last 12 months')
    expect(tooltip.attributes('aria-label'))
      .toBe('Last 12 months. Only pages published in the last 12 months')
  })

  it('uses the singular for one result and omits the badge without '
    + 'freshness', async () => {
    const wrapper = await mountStep(createData({
      results: [{ title: 'One', url: 'https://example.com/one' }],
    }))

    expect(wrapper.get('[data-testid="reasoning-search-step-count"]').text())
      .toBe('1 result')
    expect(
      wrapper.find('[data-testid="reasoning-search-step-freshness"]').exists(),
    ).toBe(false)
    expect(
      wrapper
        .find('[data-testid="reasoning-search-step-freshness-tooltip"]')
        .exists(),
    ).toBe(false)
  })

  it('shows the query and an ellipsis while pending, with no count and no '
    + 'chevron', async () => {
    const wrapper = await mountStep(
      createData({ state: 'pending', hasOutput: false }),
      { title: 'Searching with Exa', pending: true },
    )

    expect(wrapper.get('[data-testid="reasoning-search-step-title"]').text())
      .toBe('Searching with Exa…')
    expect(wrapper.get('[data-testid="reasoning-search-step-query"]').text())
      .toBe('“poland election results”')
    expect(wrapper.find('[data-testid="reasoning-search-step-count"]').exists())
      .toBe(false)
    expect(wrapper.find('.iconify').exists()).toBe(false)
    expect(trigger(wrapper).attributes('disabled')).toBeDefined()
    expect(trigger(wrapper).attributes('aria-expanded')).toBeUndefined()
    expect(trigger(wrapper).attributes('aria-controls')).toBeUndefined()
  })

  it('renders a streaming step whose input has no query yet', async () => {
    const wrapper = await mountStep(
      createData({ state: 'pending', hasOutput: false, query: '' }),
      { title: 'Searching with Brave', pending: true },
    )

    expect(wrapper.get('[data-testid="reasoning-search-step-title"]').text())
      .toBe('Searching with Brave…')
    expect(wrapper.find('[data-testid="reasoning-search-step-query"]').exists())
      .toBe(false)
  })

  it('shows "No results" and stays non-expandable with an empty result '
    + 'list', async () => {
    const wrapper = await mountStep(createData({ results: [] }))

    expect(wrapper.get('[data-testid="reasoning-search-step-count"]').text())
      .toBe('No results')
    expect(trigger(wrapper).attributes('disabled')).toBeDefined()
  })

  it('toggles the result list and aria-expanded on click', async () => {
    const wrapper = await mountStep(createData({
      results: [{
        title: 'Election results',
        url: 'https://www.example.com/news/1',
        publishedDate: '2026-05-04',
      }],
    }))

    expect(trigger(wrapper).attributes('aria-expanded')).toBe('false')
    expect(trigger(wrapper).attributes('aria-controls')).toBeUndefined()

    await trigger(wrapper).trigger('click')

    const contentId = trigger(wrapper).attributes('aria-controls')

    expect(trigger(wrapper).attributes('aria-expanded')).toBe('true')
    expect(contentId).toBeTruthy()
    expect(wrapper.get(`[id="${contentId}"]`).exists()).toBe(true)
    expect(wrapper.find('[role="region"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="reasoning-search-step-host"]').text())
      .toBe('example.com')
    expect(wrapper.get('[data-testid="reasoning-search-step-link"]').text())
      .toBe('Election results')
    expect(wrapper.get('[data-testid="reasoning-search-step-date"]').text())
      .toContain('2026')

    await trigger(wrapper).trigger('click')

    expect(trigger(wrapper).attributes('aria-expanded')).toBe('false')
    expect(trigger(wrapper).attributes('aria-controls')).toBeUndefined()
    expect(wrapper.find('[data-testid="reasoning-search-step-results"]').exists())
      .toBe(false)
  })

  it('is a native button, so Enter and Space activation is handled by the '
    + 'browser', async () => {
    const wrapper = await mountStep(createData({
      results: [{ title: 'One', url: 'https://example.com/one' }],
    }))

    expect(trigger(wrapper).element.tagName).toBe('BUTTON')
    expect(trigger(wrapper).attributes('type')).toBe('button')
  })

  it('omits the date when publishedDate is missing or unparsable',
    async () => {
      const wrapper = await mountStep(createData({
        results: [
          { title: 'One', url: 'https://example.com/one' },
          {
            title: 'Two',
            url: 'https://example.com/two',
            publishedDate: 'not a date',
          },
        ],
      }))

      await trigger(wrapper).trigger('click')

      expect(wrapper.findAll('[data-testid="reasoning-search-step-date"]'))
        .toHaveLength(0)
    })

  it('shows at most ten results', async () => {
    const results = Array.from({ length: 12 }, (_value, index) => {
      return {
        title: `Result ${index}`,
        url: `https://example.com/${index}`,
      }
    })
    const wrapper = await mountStep(createData({ results }))

    expect(wrapper.get('[data-testid="reasoning-search-step-count"]').text())
      .toBe('12 results')

    await trigger(wrapper).trigger('click')

    expect(wrapper.findAll('[data-testid="reasoning-search-step-link"]'))
      .toHaveLength(10)
    expect(wrapper.get('[data-testid="reasoning-search-step-more"]').text())
      .toBe('+2 more')
  })

  it('omits the "more" line when every result is shown', async () => {
    const results = Array.from({ length: 10 }, (_value, index) => {
      return {
        title: `Result ${index}`,
        url: `https://example.com/${index}`,
      }
    })
    const wrapper = await mountStep(createData({ results }))

    await trigger(wrapper).trigger('click')

    expect(wrapper.find('[data-testid="reasoning-search-step-more"]').exists())
      .toBe(false)
  })

  it('pins the wrapping classes that keep the collapsed row inside '
    + 'narrow screens', async () => {
    const wrapper = await mountStep(createData({
      freshness: 'week',
      results: [{ title: 'One', url: 'https://example.com/one' }],
    }))
    const meta = wrapper.get('[data-testid="reasoning-search-step-meta"]')
    const query = wrapper.get('[data-testid="reasoning-search-step-query"]')

    expect(trigger(wrapper).classes()).toContain('flex-wrap')
    expect(trigger(wrapper).classes()).toContain('min-w-0')
    expect(meta.classes()).toEqual(expect.arrayContaining([
      'basis-full',
      'min-w-0',
      'sm:basis-auto',
    ]))
    expect(query.classes()).toEqual(expect.arrayContaining([
      'min-w-0',
      'truncate',
    ]))
    expect(
      wrapper
        .get('[data-testid="reasoning-search-step-freshness-tooltip"]')
        .classes(),
    ).toContain('shrink-0')
    expect(
      wrapper.get('[data-testid="reasoning-search-step-count"]').classes(),
    ).toContain('shrink-0')
  })

  it('renders no meta container when there is nothing to show', async () => {
    const wrapper = await mountStep(
      createData({ state: 'pending', hasOutput: false, query: '' }),
      { pending: true },
    )

    expect(wrapper.find('[data-testid="reasoning-search-step-meta"]').exists())
      .toBe(false)
  })

  it('opens an http result through the shared external link flow',
    async () => {
      const wrapper = await mountStep(createData({
        results: [{ title: 'One', url: 'https://example.com/one' }],
      }))

      await trigger(wrapper).trigger('click')
      await wrapper
        .get('[data-testid="reasoning-search-step-link"]')
        .trigger('click')

      expect(mocks.openResearchLink)
        .toHaveBeenCalledWith('https://example.com/one')
    })

  it('does not render a non-http url as a link', async () => {
    const wrapper = await mountStep(createData({
      results: [
        { title: 'Evil', url: 'javascript:alert(1)' },
        { title: 'Good', url: 'https://example.com/good' },
      ],
    }))

    await trigger(wrapper).trigger('click')

    const links = wrapper.findAll('[data-testid="reasoning-search-step-link"]')

    expect(links).toHaveLength(1)
    expect(links[0]?.text()).toBe('Good')
    expect(wrapper.get('[data-testid="reasoning-search-step-text"]').text())
      .toBe('Evil')
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('shows the human reason, not raw JSON, when the search failed',
    async () => {
      const wrapper = await mountStep(
        createData({
          state: 'failed',
          hasOutput: false,
          errorReason: 'Brave rejected the saved API key. HTTP 401.',
        }),
        { title: 'Brave search failed' },
      )

      expect(
        wrapper.find('[data-testid="reasoning-search-step-count"]').exists(),
      ).toBe(false)

      await trigger(wrapper).trigger('click')

      const error = wrapper.get('[data-testid="reasoning-search-step-error"]')

      expect(error.text()).toBe('Brave rejected the saved API key. HTTP 401.')
      expect(error.text()).not.toContain('{')
    })
})
