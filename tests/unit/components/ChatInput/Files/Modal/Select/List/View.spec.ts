import { computed, ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it } from 'vitest'
import ListView from '../../../../../../../../app/components/ChatInput/Files/Modal/Select/List/View.vue'

const documentsActive = ref<boolean>(true)

mockNuxtImport('useFeature', () => {
  return () => computed(() => {
    return {
      enabled: documentsActive.value,
      active: documentsActive.value,
      variant: null,
    }
  })
})

const file = {
  id: 'file-1',
  storageKey: 'file-1.pdf',
  name: 'Report.pdf',
  size: 2048,
  type: 'application/pdf',
  source: 'upload' as const,
  createdAt: '2026-07-15T12:00:00.000Z',
}

function mountListView(props: Record<string, unknown> = {}) {
  return mountSuspended(ListView, {
    props: {
      files: [file],
      selectedIds: new Set<string>(),
      isTouchSelecting: false,
      touchedIndices: new Set<number>(),
      allSelected: false,
      hasSelection: false,
      ...props,
    },
  })
}

describe('ChatInput/Files/Modal/Select/List/View', () => {
  beforeEach(() => {
    documentsActive.value = true
  })

  it('previews a document file without selecting the row', async () => {
    const documentFile = { ...file, documentId: 'doc-1' }
    const wrapper = await mountListView({ files: [documentFile] })
    const preview = wrapper.get('[data-testid="files-action-preview"]')

    expect(preview.attributes('aria-label')).toBe('Preview document')

    await preview.trigger('click')

    expect(wrapper.emitted('preview')?.[0]).toEqual([documentFile])
    expect(wrapper.emitted('file-click')).toBeUndefined()
  })

  it('hides the AI badge for a connected app document and marks it',
    async () => {
      const documentFile = {
        ...file,
        source: 'assistant' as const,
        documentId: 'doc-1',
        documentAiGenerated: false,
      }
      const wrapper = await mountListView({ files: [documentFile] })

      expect(wrapper.find('[data-testid="files-ai-badge"]').exists())
        .toBe(false)
      expect(wrapper.get('[data-testid="files-app-badge"]').text())
        .toBe('App')
    })

  it('keeps the AI badge for AI documents and generated files', async () => {
    const generated = { ...file, source: 'assistant' as const }
    const aiDocument = {
      ...generated,
      id: 'file-2',
      documentId: 'doc-2',
      documentAiGenerated: true,
    }
    const wrapper = await mountListView({ files: [aiDocument, generated] })

    expect(wrapper.findAll('[data-testid="files-ai-badge"]')).toHaveLength(2)
    expect(wrapper.find('[data-testid="files-app-badge"]').exists())
      .toBe(false)
  })

  it('has no preview action without a document id or the feature',
    async () => {
      const withoutId = await mountListView({
        files: [{ ...file, documentId: null }],
      })

      expect(withoutId.find('[data-testid="files-action-preview"]').exists())
        .toBe(false)

      documentsActive.value = false

      const withoutFeature = await mountListView({
        files: [{ ...file, documentId: 'doc-1' }],
      })

      expect(withoutFeature.find('[data-testid="files-action-preview"]')
        .exists()).toBe(false)
    })

  it('pins the table header at the top of the scroll area by default', async () => {
    const wrapper = await mountListView()
    const table = wrapper.get('[data-testid="files-list-table"]')

    expect(table.classes()).toContain('table-pin-rows')
    expect(table.get('thead').classes()).not.toContain('top-11')
  })

  it('pins the table header below a section header when offset', async () => {
    const wrapper = await mountListView({ stickyOffset: true })
    const table = wrapper.get('[data-testid="files-list-table"]')

    expect(table.classes()).toContain('table-pin-rows')
    expect(table.get('thead').classes()).toContain('top-11')
  })

  it('emits file clicks and select all', async () => {
    const wrapper = await mountListView()

    await wrapper.get('[data-file-index="0"]').trigger('click')
    await wrapper.get('thead input[type="checkbox"]').trigger('change')

    expect(wrapper.emitted('file-click')?.[0]?.[1]).toEqual(file)
    expect(wrapper.emitted('toggle-select-all')).toHaveLength(1)
  })

  it('shows the added date and a longer name only from lg', async () => {
    const longFile = {
      ...file,
      name: 'Quarterly planning notes for the whole product team 2026.pdf',
    }
    const wrapper = await mountListView({ files: [longFile] })
    const headers = wrapper.findAll('th').map(header => header.text())
    const addedHeader = wrapper.findAll('th').find((header) => {
      return header.text() === 'Added'
    })
    const addedCell = wrapper.get('tbody time')
    const wideName = wrapper.get('tbody span.hidden.lg\\:block')
    const narrowName = wrapper.get('tbody span.lg\\:hidden')

    expect(headers).toContain('Added')
    expect(addedHeader?.classes()).toEqual(expect.arrayContaining([
      'hidden',
      'lg:table-cell',
    ]))
    expect(addedCell.attributes('datetime')).toBe('2026-07-15T12:00:00.000Z')
    expect(addedCell.element.closest('td')?.className)
      .toContain('lg:table-cell')
    expect(wideName.text().length).toBeGreaterThan(narrowName.text().length)
    expect(wideName.attributes('title')).toBe(longFile.name)
  })

  it('dims a row the model cannot accept and explains why', async () => {
    const reason = 'This model does not support PDF input.'
    const wrapper = await mountListView({
      unsupportedReasons: { 'file-1': reason },
    })
    const row = wrapper.get('[data-file-index="0"]')

    expect(row.attributes('aria-disabled')).toBe('true')
    expect(row.attributes('title')).toBe(reason)
    expect(row.classes()).toEqual(
      expect.arrayContaining(['opacity-40', 'cursor-not-allowed']),
    )
  })

  it('leaves a supported row enabled', async () => {
    const wrapper = await mountListView()
    const row = wrapper.get('[data-file-index="0"]')

    expect(row.attributes('aria-disabled')).toBeUndefined()
    expect(row.classes()).not.toContain('opacity-40')
  })
})
