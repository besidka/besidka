import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { createSSRApp, nextTick } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import type { KnowledgeItem } from '../../../../../shared/types/project-knowledge.d'
import Item from '../../../../../app/components/Projects/Knowledge/Item.vue'
import { createKnowledgeItem } from '../../../../setup/helpers/knowledge-ui-fixtures'

enableAutoUnmount(afterEach)

async function mountItem(
  item: KnowledgeItem = createKnowledgeItem(),
  tokens: number | null = 1500,
  isRemoving: boolean = false,
) {
  const wrapper = await mountSuspended(Item, {
    props: { item, tokens, isRemoving },
  })

  await nextTick()

  return wrapper
}

function text(wrapper: Awaited<ReturnType<typeof mountItem>>, id: string) {
  return wrapper.get(`[data-testid="${id}"]`).text()
}

describe('Projects/Knowledge/Item', () => {
  it('shows the name, type, size, tokens and a ready badge', async () => {
    const wrapper = await mountItem()

    expect(text(wrapper, 'knowledge-item-name')).toBe('README.md')
    expect(text(wrapper, 'knowledge-item-type')).toBe('Text')
    expect(text(wrapper, 'knowledge-item-size')).toBe('1 KB')
    expect(text(wrapper, 'knowledge-item-tokens')).toBe('~1.5k tokens')
    expect(text(wrapper, 'knowledge-item-status')).toBe('ready')
  })

  it('shows the updated age in the meta line next to the size', async () => {
    const wrapper = await mountItem(createKnowledgeItem({
      updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
        .toISOString(),
    }))
    const updated = wrapper.get('[data-testid="knowledge-item-updated"]')

    expect(updated.text()).toBe('Updated 3 days ago')
    expect(updated.element.parentElement)
      .toBe(wrapper.get('[data-testid="knowledge-item-size"]')
        .element.parentElement)
  })

  it('renders no relative time on the server, only a placeholder',
    async () => {
      const html = await renderToString(createSSRApp(Item, {
        item: createKnowledgeItem(),
        tokens: 1500,
        isRemoving: false,
      }))

      expect(html).not.toContain('ago')
      expect(html).not.toContain('Updated')
      expect(html).not.toContain('knowledge-item-updated"')
      expect(html).toContain('knowledge-item-updated-placeholder')
    })

  it('swaps the placeholder for the updated age after mount', async () => {
    const wrapper = await mountItem()

    expect(wrapper.find('[data-testid="knowledge-item-updated-placeholder"]')
      .exists()).toBe(false)
    expect(wrapper.find('[data-testid="knowledge-item-updated"]').exists())
      .toBe(true)
  })

  it('keeps the meta line on its own row on mobile', async () => {
    const wrapper = await mountItem()
    const meta = wrapper.get('[data-testid="knowledge-item-type"]')
      .element.parentElement!

    expect(meta.className).toContain('col-span-2')
    expect(meta.className).toContain('sm:col-span-1')
  })

  it('names folder items by their relative path', async () => {
    const wrapper = await mountItem(createKnowledgeItem({
      title: 'a.ts',
      relativePath: 'src/lib/a.ts',
    }))

    expect(text(wrapper, 'knowledge-item-name')).toBe('src/lib/a.ts')
  })

  it('falls back to the text size for a note without a file size', async () => {
    const wrapper = await mountItem(createKnowledgeItem({
      kind: 'note',
      extractor: 'note',
      sizeBytes: null,
      textBytes: 800,
    }))

    expect(text(wrapper, 'knowledge-item-type')).toBe('Note')
    expect(text(wrapper, 'knowledge-item-size')).toBe('800 B')
  })

  it('shows the description under the name', async () => {
    const wrapper = await mountItem(createKnowledgeItem({
      description: 'Weekly sync',
    }))

    expect(text(wrapper, 'knowledge-item-description')).toBe('Weekly sync')
  })

  it('flags a document with no text', async () => {
    const wrapper = await mountItem(createKnowledgeItem({
      extractStatus: 'no-text',
    }), 0)

    expect(text(wrapper, 'knowledge-item-status')).toBe('no text found')
    expect(wrapper.find('[data-testid="knowledge-item-tokens"]').exists())
      .toBe(false)
  })

  it('offers a retry on a failed extraction', async () => {
    const item = createKnowledgeItem({
      extractStatus: 'failed',
      extractError: 'too-large',
    })
    const wrapper = await mountItem(item, 0)
    const badge = wrapper.get('[data-testid="knowledge-item-status"]')

    expect(badge.element.tagName).toBe('BUTTON')
    expect(badge.text()).toBe('failed – retry')

    await badge.trigger('click')

    expect(wrapper.emitted('edit')).toEqual([[item]])
  })

  it('hides tokens until the chat model is known', async () => {
    const wrapper = await mountItem(createKnowledgeItem(), null)

    expect(wrapper.find('[data-testid="knowledge-item-tokens"]').exists())
      .toBe(false)
  })

  it('emits edit from the name and the edit button, and remove', async () => {
    const item = createKnowledgeItem()
    const wrapper = await mountItem(item)

    await wrapper.get('[data-testid="knowledge-item-open"]').trigger('click')
    await wrapper.get('[data-testid="knowledge-item-edit"]').trigger('click')
    await wrapper.get('[data-testid="knowledge-item-remove"]')
      .trigger('click')

    expect(wrapper.emitted('edit')).toEqual([[item], [item]])
    expect(wrapper.emitted('remove')).toEqual([[item]])
  })

  it('labels the icon buttons with the item name', async () => {
    const wrapper = await mountItem()

    expect(wrapper.get('[data-testid="knowledge-item-edit"]')
      .attributes('aria-label')).toBe('Edit README.md')
    expect(wrapper.get('[data-testid="knowledge-item-remove"]')
      .attributes('aria-label')).toBe('Remove README.md')
  })

  it('disables removal while the item is being removed', async () => {
    const wrapper = await mountItem(createKnowledgeItem(), 10, true)

    expect(wrapper.get('[data-testid="knowledge-item-remove"]')
      .attributes('disabled')).toBeDefined()
  })

  it('uses a rounded-box row, never a pill radius', async () => {
    const wrapper = await mountItem()

    expect(wrapper.get('[data-testid="knowledge-item"]').classes())
      .toContain('rounded-box')
    expect(wrapper.html()).not.toContain('rounded-full')
  })
})
