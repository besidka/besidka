import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { DocumentLibraryItem } from '../../../../shared/utils/documents'
import HistoryDocumentRow from '../../../../app/components/History/DocumentRow.vue'

enableAutoUnmount(afterEach)

function createItem(
  overrides: Partial<DocumentLibraryItem> = {},
): DocumentLibraryItem {
  return {
    id: 'doc-1',
    format: 'pdf',
    title: 'Quarterly report',
    source: 'chat',
    aiGenerated: true,
    fileId: 'file-1',
    fileName: 'Quarterly report.pdf',
    storageKey: 'quarterly-report.pdf',
    size: 2048,
    stats: { pages: 3, slides: null, sheets: null, cells: null, images: 0 },
    originChatSlug: 'chat-slug',
    originChatTitle: 'Planning chat',
    createdAt: '2026-11-09T08:00:00.000Z',
    ...overrides,
  }
}

function mountRow(item: DocumentLibraryItem) {
  return mountSuspended(HistoryDocumentRow, {
    props: { item },
    global: {
      stubs: {
        UiLocalDate: true,
        NuxtLink: {
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  })
}

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('History/DocumentRow', () => {
  it('shows the title, format badge, size and page count', async () => {
    const wrapper = await mountRow(createItem())

    expect(wrapper.get(testId('document-row-open')).text())
      .toBe('Quarterly report')

    const format = wrapper.get(testId('document-row-format'))

    expect(format.text()).toBe('PDF')
    expect(format.classes()).toEqual(
      expect.arrayContaining(['badge', 'badge-soft', 'badge-sm']),
    )
    expect(wrapper.get(testId('document-row-meta')).text())
      .toBe('3 pages · 2.0 KB')
  })

  it.each([
    ['docx', 'Word', '12 pages'],
    ['pptx', 'PowerPoint', '8 slides'],
    ['xlsx', 'Excel', '2 sheets'],
  ] as const)('labels %s as %s with its unit', async (format, label, count) => {
    const wrapper = await mountRow(createItem({
      format,
      stats: {
        pages: format === 'docx' ? 12 : null,
        slides: format === 'pptx' ? 8 : null,
        sheets: format === 'xlsx' ? 2 : null,
        cells: null,
        images: 0,
      },
    }))

    expect(wrapper.get(testId('document-row-format')).text()).toBe(label)
    expect(wrapper.get(testId('document-row-meta')).text())
      .toContain(count)
  })

  it('links the Chat source badge to the origin chat', async () => {
    const wrapper = await mountRow(createItem())
    const link = wrapper.get(testId('document-row-source-link'))

    expect(wrapper.get(testId('document-row-source')).text()).toBe('Chat')
    expect(link.attributes('href')).toBe('/chats/chat-slug')
    expect(wrapper.find(testId('document-row-ai')).exists()).toBe(true)
    expect(wrapper.find(testId('document-action-open-chat')).exists())
      .toBe(true)
  })

  it('shows Chat without a link when the origin chat is gone', async () => {
    const wrapper = await mountRow(createItem({
      originChatSlug: null,
      originChatTitle: null,
    }))

    expect(wrapper.get(testId('document-row-source')).text()).toBe('Chat')
    expect(wrapper.find(testId('document-row-source-link')).exists())
      .toBe(false)
    expect(wrapper.find(testId('document-action-open-chat')).exists())
      .toBe(false)
  })

  it('marks a connected app document without a chat link', async () => {
    const wrapper = await mountRow(createItem({
      source: 'mcp',
      aiGenerated: false,
      originChatSlug: null,
      originChatTitle: null,
    }))

    expect(wrapper.get(testId('document-row-source')).text())
      .toBe('Connected app')
    expect(wrapper.find(testId('document-row-source-link')).exists())
      .toBe(false)
    expect(wrapper.find(testId('document-row-ai')).exists()).toBe(false)
    expect(wrapper.find(testId('document-action-open-chat')).exists())
      .toBe(false)
  })

  it('shows the AI badge on a connected app document the caller declared AI',
    async () => {
      const wrapper = await mountRow(createItem({
        source: 'mcp',
        aiGenerated: true,
        originChatSlug: null,
        originChatTitle: null,
      }))

      expect(wrapper.get(testId('document-row-source')).text())
        .toBe('Connected app')
      expect(wrapper.find(testId('document-row-ai')).exists()).toBe(true)
    })

  it('hides the AI badge on a chat document flagged as not AI', async () => {
    const wrapper = await mountRow(createItem({ aiGenerated: false }))

    expect(wrapper.find(testId('document-row-ai')).exists()).toBe(false)
  })

  it('offers preview, download, rename and delete actions', async () => {
    const item = createItem()
    const wrapper = await mountRow(item)
    const download = wrapper.get(testId('document-action-download'))

    expect(download.attributes('href'))
      .toBe('/files/quarterly-report.pdf?download=1')
    expect(download.attributes('download')).toBeDefined()

    await wrapper.get(testId('document-action-preview')).trigger('click')
    await wrapper.get(testId('document-action-rename')).trigger('click')
    await wrapper.get(testId('document-action-delete')).trigger('click')

    expect(wrapper.emitted('preview')?.[0]).toEqual([item])
    expect(wrapper.emitted('rename')?.[0]).toEqual([item])
    expect(wrapper.emitted('delete')?.[0]).toEqual([item])
  })

  it('previews from the title button', async () => {
    const item = createItem()
    const wrapper = await mountRow(item)

    await wrapper.get(testId('document-row-open')).trigger('click')

    expect(wrapper.emitted('preview')?.[0]).toEqual([item])
  })

  it('never uses a colour fill on the row chrome',
    async () => {
      const wrapper = await mountRow(createItem())

      expect(wrapper.html()).not.toMatch(/btn-(primary|accent)/)
      expect(wrapper.html()).not.toMatch(/\btext-(primary|accent)/)
    })
})
