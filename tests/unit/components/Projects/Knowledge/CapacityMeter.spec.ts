import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  KnowledgeItem,
  KnowledgeMode,
} from '../../../../../shared/types/project-knowledge.d'
import type { KnowledgeModelContext } from '../../../../../app/types/knowledge-ui.d'
import CapacityMeter from '../../../../../app/components/Projects/Knowledge/CapacityMeter.vue'
import {
  createKnowledgeItem,
  createKnowledgeModelContext,
  sumKnowledgeTotals,
} from '../../../../setup/helpers/knowledge-ui-fixtures'

enableAutoUnmount(afterEach)

const MEGABYTE = 1024 * 1024

interface MeterOptions {
  items?: KnowledgeItem[]
  mode?: KnowledgeMode
  model?: KnowledgeModelContext
  storageTotalBytes?: number | null
  accountItems?: number
  isReady?: boolean
}

async function mountMeter(options: MeterOptions = {}) {
  const items = options.items ?? [
    createKnowledgeItem({ latinChars: 35_000, textBytes: 35_000 }),
  ]

  return await mountSuspended(CapacityMeter, {
    props: {
      items,
      totals: sumKnowledgeTotals(items),
      mode: options.mode ?? 'auto',
      model: options.model ?? createKnowledgeModelContext(),
      storageTotalBytes: options.storageTotalBytes === undefined
        ? 20 * MEGABYTE
        : options.storageTotalBytes,
      accountItems: options.accountItems ?? 3,
      isReady: options.isReady ?? true,
    },
  })
}

function text(wrapper: Awaited<ReturnType<typeof mountMeter>>, id: string) {
  return wrapper.get(`[data-testid="${id}"]`).text()
}

describe('Projects/Knowledge/CapacityMeter', () => {
  describe('within budget', () => {
    it('shows tokens, percentage, budget and the cost per message', async () => {
      const wrapper = await mountMeter()

      expect(text(wrapper, 'knowledge-meter-headline'))
        .toBe('Project knowledge · 10k tokens')
      expect(text(wrapper, 'knowledge-meter-bar-label')).toBe(
        '16% of Test Model\'s full-context budget (64k)',
      )
      expect(text(wrapper, 'knowledge-meter-summary')).toBe(
        'All files are sent with every message · ≈ $0.030 per message, '
        + '< $0.01 when cached',
      )
    })

    it('exposes the bar as a labelled progress with its value', async () => {
      const wrapper = await mountMeter()
      const bar = wrapper.get('[data-testid="knowledge-meter-bar"]')

      expect(bar.element.tagName).toBe('PROGRESS')
      expect(bar.classes()).toContain('progress')
      expect(bar.attributes('aria-valuenow')).toBe('16')
      expect(bar.attributes('aria-valuemin')).toBe('0')
      expect(bar.attributes('aria-valuemax')).toBe('100')
      expect(bar.attributes('aria-valuetext'))
        .toContain('16% of Test Model')
      expect(bar.attributes('aria-label'))
        .toBe('Project knowledge · 10k tokens')
      expect(bar.classes()).toContain('progress-accent')
    })

    it('leaves the cached price out when caching is not available', async () => {
      const wrapper = await mountMeter({
        model: createKnowledgeModelContext({ isCachingAvailable: false }),
      })

      expect(text(wrapper, 'knowledge-meter-cost'))
        .toBe('≈ $0.030 per message')
    })

    it('leaves the cost out when the price is unknown', async () => {
      const wrapper = await mountMeter({
        model: createKnowledgeModelContext({ inputPrice: null }),
      })

      expect(wrapper.find('[data-testid="knowledge-meter-cost"]').exists())
        .toBe(false)
    })
  })

  describe('over budget', () => {
    const items = [createKnowledgeItem({ latinChars: 70_000 })]
    const model = createKnowledgeModelContext({
      name: 'Kimi K2.6',
      contextWindow: 128_000,
    })

    it('says the model searches and fills the bar as a warning', async () => {
      const wrapper = await mountMeter({ items, model })
      const bar = wrapper.get('[data-testid="knowledge-meter-bar"]')

      expect(text(wrapper, 'knowledge-meter-bar-label'))
        .toBe('over Kimi K2.6\'s budget (9k)')
      expect(text(wrapper, 'knowledge-meter-summary')).toBe(
        'Kimi K2.6 searches the files when needed · switch to a larger '
        + 'model to include everything',
      )
      expect(bar.attributes('aria-valuenow')).toBe('100')
      expect(bar.classes()).toContain('progress-warning')
      expect(wrapper.find('[data-testid="knowledge-meter-cost"]').exists())
        .toBe(false)
    })
  })

  describe('forced modes', () => {
    it('says Always search is on', async () => {
      const wrapper = await mountMeter({ mode: 'search' })

      expect(text(wrapper, 'knowledge-meter-summary')).toContain(
        'Always search is on: Test Model searches the files when needed',
      )
    })

    it('says Always include is on', async () => {
      const wrapper = await mountMeter({ mode: 'full' })

      expect(text(wrapper, 'knowledge-meter-summary'))
        .toContain('Always include is on: all files are sent')
    })

    it('warns when Always include does not fit the model', async () => {
      const wrapper = await mountMeter({
        mode: 'full',
        items: [createKnowledgeItem({ latinChars: 3_500_000 })],
        model: createKnowledgeModelContext({ contextWindow: 100_000 }),
      })

      expect(text(wrapper, 'knowledge-meter-warning'))
        .toContain('does not fit')
      expect(text(wrapper, 'knowledge-meter-summary'))
        .toContain('searches the files when needed')
    })
  })

  describe('context window and gateway models', () => {
    it('assumes 128k when the window is unknown', async () => {
      const wrapper = await mountMeter({
        model: createKnowledgeModelContext({ contextWindow: null }),
      })

      expect(text(wrapper, 'knowledge-meter-warning'))
        .toBe('Context window unknown, assuming 128k')
      expect(text(wrapper, 'knowledge-meter-bar-label')).toContain('(9k)')
    })

    it('uses the catalog window and price of a gateway model', async () => {
      const wrapper = await mountMeter({
        model: createKnowledgeModelContext({
          name: 'Vendor Model',
          contextWindow: 200_000,
          inputPrice: 2,
          cacheReadPrice: null,
          isCachingAvailable: true,
        }),
      })

      expect(text(wrapper, 'knowledge-meter-bar-label')).toContain('(14k)')
      expect(text(wrapper, 'knowledge-meter-cost'))
        .toBe('≈ $0.020 per message')
      expect(wrapper.find('[data-testid="knowledge-meter-warning"]').exists())
        .toBe(false)
    })
  })

  describe('account item limit', () => {
    const accountWarning = '[data-testid="knowledge-meter-account-warning"]'

    it('stays quiet while the account is below 90% of its limit', async () => {
      const wrapper = await mountMeter({ accountItems: 1_799 })

      expect(wrapper.find(accountWarning).exists()).toBe(false)
    })

    it('warns at 90% and names the account limit', async () => {
      const wrapper = await mountMeter({ accountItems: 1_800 })

      expect(text(wrapper, 'knowledge-meter-account-warning')).toBe(
        'Close to your account limit: 1,800 of 2,000 knowledge items '
        + 'across all your projects. New items are blocked at 2,000.',
      )
      expect(wrapper.get(accountWarning).classes())
        .not.toContain('text-error')
    })

    it('says the limit is reached at 2,000 and shows it as an error', async () => {
      const wrapper = await mountMeter({ accountItems: 2_000 })

      expect(text(wrapper, 'knowledge-meter-account-warning')).toContain(
        'Account limit reached: you have 2,000 of 2,000 knowledge items',
      )
      expect(wrapper.get(accountWarning).classes()).toContain('text-error')
    })

    it('is a status region and not shown while loading', async () => {
      const wrapper = await mountMeter({ accountItems: 1_900 })

      expect(wrapper.get(accountWarning).attributes('role')).toBe('status')

      const loading = await mountMeter({ accountItems: 1_900, isReady: false })

      expect(loading.find(accountWarning).exists()).toBe(false)
    })

    it('keeps the per-project cap line next to the account warning', async () => {
      const wrapper = await mountMeter({ accountItems: 1_900 })

      expect(text(wrapper, 'knowledge-meter-cap')).toContain('of 500 items')
    })
  })

  describe('storage and caps', () => {
    it('shows the knowledge text against the user storage', async () => {
      const items = [
        createKnowledgeItem({ textBytes: Math.round(1.2 * MEGABYTE) }),
      ]
      const wrapper = await mountMeter({ items })

      expect(text(wrapper, 'knowledge-meter-storage'))
        .toBe('Knowledge text 1.2 MB of your 20 MB storage')
    })

    it('drops the storage total until it is known', async () => {
      const wrapper = await mountMeter({ storageTotalBytes: null })

      expect(text(wrapper, 'knowledge-meter-storage'))
        .toBe('Knowledge text 34.2 KB')
    })

    it('shows the per-project caps', async () => {
      const items = [
        createKnowledgeItem({ textBytes: Math.round(1.2 * MEGABYTE) }),
        createKnowledgeItem({ id: 'item-2', textBytes: 0 }),
      ]
      const wrapper = await mountMeter({ items })

      expect(text(wrapper, 'knowledge-meter-cap'))
        .toBe('2 of 500 items · 1.2 MB of 2 MB')
    })
  })

  describe('before the chat model is known', () => {
    it('renders only a skeleton, with no model-dependent text', async () => {
      const wrapper = await mountMeter({ isReady: false })

      expect(wrapper.find('[data-testid="knowledge-meter-skeleton"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="knowledge-meter-headline"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="knowledge-meter-bar"]').exists())
        .toBe(false)
      expect(wrapper.text()).not.toContain('Test Model')
      expect(wrapper.text()).not.toContain('tokens')
    })
  })
})
