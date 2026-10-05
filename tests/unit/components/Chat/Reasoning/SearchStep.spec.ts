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
  options: { title?: string, pending?: boolean } = {},
): Promise<VueWrapper> {
  return await mountSuspended(SearchStep, {
    props: {
      data,
      title: options.title ?? 'Searched with Brave',
      pending: options.pending ?? false,
      idPrefix: 'reasoning-msg-1-tool-1',
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
    ).toBe('Past week')
    expect(wrapper.get('[data-testid="reasoning-search-step-count"]').text())
      .toBe('2 results')
    expect(wrapper.find('[data-testid="reasoning-search-step-results"]').exists())
      .toBe(false)
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

    await trigger(wrapper).trigger('click')

    expect(trigger(wrapper).attributes('aria-expanded')).toBe('true')
    expect(
      trigger(wrapper).attributes('aria-controls'),
    ).toBe('reasoning-msg-1-tool-1-content')
    expect(wrapper.get('#reasoning-msg-1-tool-1-content').exists()).toBe(true)
    expect(wrapper.get('[data-testid="reasoning-search-step-host"]').text())
      .toBe('example.com')
    expect(wrapper.get('[data-testid="reasoning-search-step-link"]').text())
      .toBe('Election results')
    expect(wrapper.get('[data-testid="reasoning-search-step-date"]').text())
      .toContain('2026')

    await trigger(wrapper).trigger('click')

    expect(trigger(wrapper).attributes('aria-expanded')).toBe('false')
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
