import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { KnowledgeItem } from '../../../../../shared/types/project-knowledge.d'
import ItemList from '../../../../../app/components/Projects/Knowledge/ItemList.vue'
import {
  createKnowledgeItem,
  createKnowledgeModelContext,
} from '../../../../setup/helpers/knowledge-ui-fixtures'

enableAutoUnmount(afterEach)

const items: KnowledgeItem[] = [
  createKnowledgeItem({ id: 'loose', title: 'Loose.md' }),
  createKnowledgeItem({
    id: 'a',
    title: 'a.ts',
    folderId: 'folder-1',
    relativePath: 'src/a.ts',
  }),
  createKnowledgeItem({
    id: 'b',
    title: 'b.ts',
    folderId: 'folder-1',
    relativePath: 'src/b.ts',
  }),
]

interface ListProps {
  items?: KnowledgeItem[]
  tokenModel?: ReturnType<typeof createKnowledgeModelContext> | null
  preparingRows?: Array<{ key: string, name: string }>
  syncableFolderIds?: string[]
  syncingFolderId?: string | null
  removingId?: string | null
  folderNames?: Record<string, string>
}

async function mountList(props: ListProps = {}) {
  return await mountSuspended(ItemList, {
    props: {
      items,
      tokenModel: createKnowledgeModelContext(),
      folderNames: { 'folder-1': 'my-app' },
      ...props,
    },
  })
}

describe('Projects/Knowledge/ItemList', () => {
  it('shows folder groups collapsed and loose items always', async () => {
    const wrapper = await mountList()

    expect(wrapper.get('[data-testid="knowledge-group-name"]').text())
      .toBe('my-app')
    expect(wrapper.get('[data-testid="knowledge-group-count"]').text())
      .toBe('2 files')
    expect(wrapper.find('[data-testid="knowledge-group-items"]').exists())
      .toBe(false)
    expect(wrapper.get('[data-testid="knowledge-loose-items"]').text())
      .toContain('Loose.md')
  })

  it('toggles a group with a labelled disclosure button', async () => {
    const wrapper = await mountList()
    const toggle = wrapper.get('[data-testid="knowledge-group-toggle"]')

    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.classes()).toEqual(expect.arrayContaining([
      'rounded-box',
      'focus-visible:ring-2',
    ]))

    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(toggle.attributes('aria-controls'))
      .toBe(wrapper.get('[data-testid="knowledge-group-items"]')
        .attributes('id'))
    expect(wrapper.get('[data-testid="knowledge-group-items"]').text())
      .toContain('src/a.ts')

    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('false')
  })

  it('totals the group tokens for the current model', async () => {
    const wrapper = await mountList()

    expect(wrapper.get('[data-testid="knowledge-group-tokens"]').text())
      .toBe('~586 tokens')
  })

  it('omits tokens until the chat model is known', async () => {
    const wrapper = await mountList({ tokenModel: null })

    expect(wrapper.find('[data-testid="knowledge-group-tokens"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="knowledge-item-tokens"]').exists())
      .toBe(false)
  })

  it('lists files being prepared above the items', async () => {
    const wrapper = await mountList({
      preparingRows: [{ key: 'entry-0', name: 'big.pdf' }],
    })
    const row = wrapper.get('[data-testid="knowledge-item-preparing"]')

    expect(row.text()).toContain('big.pdf')
    expect(row.text()).toContain('preparing…')
  })

  it('offers Sync now only for syncable folders', async () => {
    const plain = await mountList()
    const syncable = await mountList({ syncableFolderIds: ['folder-1'] })

    expect(plain.find('[data-testid="knowledge-group-sync"]').exists())
      .toBe(false)

    await syncable.get('[data-testid="knowledge-group-sync"]')
      .trigger('click')

    expect(syncable.emitted('sync')).toEqual([['folder-1']])
    expect(syncable.get('[data-testid="knowledge-group-sync"]')
      .attributes('aria-label')).toBe('Sync my-app now')
  })

  it('disables Sync now while any folder is syncing', async () => {
    const wrapper = await mountList({
      syncableFolderIds: ['folder-1'],
      syncingFolderId: 'folder-1',
    })

    expect(wrapper.get('[data-testid="knowledge-group-sync"]')
      .attributes('disabled')).toBeDefined()
  })

  it('passes edit and remove up from the rows', async () => {
    const wrapper = await mountList()

    await wrapper.get('[data-testid="knowledge-item-edit"]').trigger('click')
    await wrapper.get('[data-testid="knowledge-item-remove"]')
      .trigger('click')

    expect(wrapper.emitted('edit')?.[0]).toEqual([items[0]])
    expect(wrapper.emitted('remove')?.[0]).toEqual([items[0]])
  })

  it('names unnamed folders by position', async () => {
    const wrapper = await mountList({ folderNames: {} })

    expect(wrapper.get('[data-testid="knowledge-group-name"]').text())
      .toBe('Folder 1')
  })
})
