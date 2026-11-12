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

  it('labels Office files Word, Excel and PowerPoint, never by media type',
    async () => {
      const officeTypes: Array<[string, string]> = [
        [
          'application/vnd.openxmlformats-officedocument'
          + '.wordprocessingml.document',
          'Word',
        ],
        [
          'application/vnd.openxmlformats-officedocument'
          + '.spreadsheetml.sheet',
          'Excel',
        ],
        [
          'application/vnd.openxmlformats-officedocument'
          + '.presentationml.presentation',
          'PowerPoint',
        ],
      ]
      const wrapper = await mountListView({
        files: officeTypes.map(([type], index) => {
          return {
            ...file,
            id: `office-${index}`,
            storageKey: `office-${index}`,
            name: `File ${index}`,
            type,
          }
        }),
      })
      const rows = wrapper.findAll('tbody tr')

      officeTypes.forEach(([, label], index) => {
        expect(rows[index]!.text()).toContain(label)
        expect(rows[index]!.text()).not.toContain('VND.')
      })
    })

  it('shows a short caption on a row the model cannot accept', async () => {
    const wrapper = await mountListView({
      unsupportedReasons: { 'file-1': 'No text could be read.' },
      unsupportedCaptions: { 'file-1': 'No readable text' },
    })
    const caption = wrapper.get('[data-testid="files-unsupported-caption"]')

    expect(caption.text()).toBe('No readable text')
    expect(caption.classes()).toEqual(expect.arrayContaining([
      'badge',
      'badge-soft',
      'badge-xs',
    ]))
  })

  it('shows a quiet note on a row whose text leaves content out', async () => {
    const wrapper = await mountListView({
      textNotes: {
        'file-1': {
          label: '1 image not sent',
          description: 'The model gets this file\'s text only.',
          isBlocking: false,
        },
      },
    })
    const note = wrapper.get('[data-testid="files-text-note"]')

    expect(note.text()).toBe('1 image not sent')
    expect(note.attributes('title')).toBe(
      'The model gets this file\'s text only.',
    )
    expect(note.classes()).toEqual(expect.arrayContaining([
      'badge',
      'badge-soft',
      'badge-xs',
    ]))
  })

  it('shows the caption instead of the note on a disabled row', async () => {
    const wrapper = await mountListView({
      unsupportedReasons: { 'file-1': 'No text could be read.' },
      unsupportedCaptions: { 'file-1': 'No readable text' },
      textNotes: {
        'file-1': { label: 'Shortened', description: '', isBlocking: false },
      },
    })

    expect(wrapper.find('[data-testid="files-unsupported-caption"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="files-text-note"]').exists())
      .toBe(false)
  })

  it('shows no note on a row with nothing left out', async () => {
    const wrapper = await mountListView()

    expect(wrapper.find('[data-testid="files-text-note"]').exists())
      .toBe(false)
  })

  it('shows no caption on a supported row', async () => {
    const wrapper = await mountListView()

    expect(wrapper.find('[data-testid="files-unsupported-caption"]').exists())
      .toBe(false)
  })

  it('leaves a supported row enabled', async () => {
    const wrapper = await mountListView()
    const row = wrapper.get('[data-file-index="0"]')

    expect(row.attributes('aria-disabled')).toBeUndefined()
    expect(row.classes()).not.toContain('opacity-40')
  })
})
