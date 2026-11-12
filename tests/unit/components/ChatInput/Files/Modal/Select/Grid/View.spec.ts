import { computed, ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it } from 'vitest'
import GridView from '../../../../../../../../app/components/ChatInput/Files/Modal/Select/Grid/View.vue'
import GridSkeleton from '../../../../../../../../app/components/ChatInput/Files/Modal/Select/Grid/Skeleton.vue'

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
  storageKey: 'file-1.png',
  name: 'Generated image.png',
  size: 2048,
  type: 'image/png',
  source: 'assistant' as const,
  createdAt: '2026-07-15T12:00:00.000Z',
}

const documentFile = {
  ...file,
  id: 'file-2',
  storageKey: 'file-2.pdf',
  name: 'Report.pdf',
  type: 'application/pdf',
  documentId: 'doc-2',
}

function mountDocumentGrid(files: Array<Record<string, unknown>>) {
  return mountSuspended(GridView, {
    props: {
      files,
      selectedIds: new Set<string>(),
      isTouchSelecting: false,
      touchedIndices: new Set<number>(),
    },
  })
}

describe('ChatInput/Files/Modal/Select/Grid/View', () => {
  beforeEach(() => {
    documentsActive.value = true
  })

  it('previews a document file without selecting the tile', async () => {
    const wrapper = await mountDocumentGrid([documentFile])
    const preview = wrapper.get('[data-testid="files-action-preview"]')

    expect(preview.attributes('aria-label')).toBe('Preview document')
    expect(wrapper.find('[aria-label="Download Report.pdf"]').exists())
      .toBe(true)

    await preview.trigger('click')

    expect(wrapper.emitted('preview')?.[0]).toEqual([documentFile])
    expect(wrapper.emitted('file-click')).toBeUndefined()
  })

  it('has no preview action without a document id or the feature',
    async () => {
      const wrapper = await mountDocumentGrid([
        { ...documentFile, documentId: null },
        file,
      ])

      expect(wrapper.find('[data-testid="files-action-preview"]').exists())
        .toBe(false)

      documentsActive.value = false

      const withoutFeature = await mountDocumentGrid([documentFile])

      expect(withoutFeature.find('[data-testid="files-action-preview"]')
        .exists()).toBe(false)
    })

  it('hides the AI badge for a connected app document and marks it',
    async () => {
      const wrapper = await mountDocumentGrid([
        { ...documentFile, documentAiGenerated: false },
      ])

      expect(wrapper.find('[data-testid="files-ai-badge"]').exists())
        .toBe(false)
      expect(wrapper.get('[data-testid="files-app-badge"]').text())
        .toBe('App')
    })

  it('keeps the AI badge for AI documents and generated files', async () => {
    const wrapper = await mountDocumentGrid([
      { ...documentFile, documentAiGenerated: true },
      { ...documentFile, id: 'file-3', documentAiGenerated: null },
      file,
    ])

    expect(wrapper.findAll('[data-testid="files-ai-badge"]')).toHaveLength(3)
    expect(wrapper.find('[data-testid="files-app-badge"]').exists())
      .toBe(false)
  })

  it('selects only when keyboard events originate from the tile', async () => {
    const wrapper = await mountSuspended(GridView, {
      props: {
        files: [file],
        selectedIds: new Set<string>(),
        isTouchSelecting: false,
        touchedIndices: new Set<number>(),
      },
    })
    const tile = wrapper.get('[data-file-index="0"]')

    await tile.trigger('keydown', { key: 'Enter' })
    await tile.trigger('keydown', { key: ' ' })

    expect(wrapper.emitted('file-click')).toHaveLength(2)

    const download = wrapper.get('[aria-label="Download Generated image.png"]')
    const rename = wrapper.get('[aria-label="Rename file"]')
    const remove = wrapper.get('[aria-label="Delete file"]')

    await download.trigger('keydown', { key: 'Enter' })
    await download.trigger('keydown', { key: ' ' })
    await rename.trigger('keydown', { key: 'Enter' })
    await rename.trigger('keydown', { key: ' ' })
    await remove.trigger('keydown', { key: 'Enter' })
    await remove.trigger('keydown', { key: ' ' })

    expect(wrapper.emitted('file-click')).toHaveLength(2)

    await rename.trigger('click')
    await remove.trigger('click')

    expect(wrapper.emitted('rename')?.[0]).toEqual([file])
    expect(wrapper.emitted('delete')?.[0]).toEqual([file])
    expect(wrapper.emitted('file-click')).toHaveLength(2)
  })

  it('dims a tile the model cannot accept and explains why', async () => {
    const reason = 'This model does not support image input.'
    const wrapper = await mountSuspended(GridView, {
      props: {
        files: [file],
        selectedIds: new Set<string>(),
        isTouchSelecting: false,
        touchedIndices: new Set<number>(),
        unsupportedReasons: { 'file-1': reason },
      },
    })
    const tile = wrapper.get('[data-file-index="0"]')

    expect(tile.attributes('aria-disabled')).toBe('true')
    expect(tile.attributes('title')).toBe(reason)
    expect(tile.classes()).toEqual(
      expect.arrayContaining(['opacity-40', 'cursor-not-allowed']),
    )
  })

  it('shows a short caption on a tile the model cannot accept', async () => {
    const wrapper = await mountSuspended(GridView, {
      props: {
        files: [file],
        selectedIds: new Set<string>(),
        isTouchSelecting: false,
        touchedIndices: new Set<number>(),
        unsupportedReasons: { 'file-1': 'No text could be read.' },
        unsupportedCaptions: { 'file-1': 'No readable text' },
      },
    })
    const caption = wrapper.get('[data-testid="files-unsupported-caption"]')

    expect(caption.text()).toBe('No readable text')
    expect(caption.classes()).toEqual(expect.arrayContaining([
      'badge',
      'badge-neutral',
      'badge-xs',
    ]))
    expect(caption.classes()).not.toContain('badge-soft')
  })

  it('shows a quiet note on a tile whose text leaves content out', async () => {
    const wrapper = await mountSuspended(GridView, {
      props: {
        files: [file],
        selectedIds: new Set<string>(),
        isTouchSelecting: false,
        touchedIndices: new Set<number>(),
        textNotes: {
          'file-1': {
            label: 'Shortened',
            description: 'It is long, so only the start is sent.',
            isBlocking: false,
          },
        },
      },
    })
    const note = wrapper.get('[data-testid="files-text-note"]')

    expect(note.text()).toBe('Shortened')
    expect(note.attributes('title')).toBe(
      'It is long, so only the start is sent.',
    )
    expect(note.classes()).toEqual(expect.arrayContaining([
      'badge',
      'badge-soft',
      'badge-xs',
    ]))
  })

  it('shows no note on a tile with nothing left out', async () => {
    const wrapper = await mountSuspended(GridView, {
      props: {
        files: [file],
        selectedIds: new Set<string>(),
        isTouchSelecting: false,
        touchedIndices: new Set<number>(),
      },
    })

    expect(wrapper.find('[data-testid="files-text-note"]').exists())
      .toBe(false)
  })

  it('leaves a supported tile enabled', async () => {
    const wrapper = await mountSuspended(GridView, {
      props: {
        files: [file],
        selectedIds: new Set<string>(),
        isTouchSelecting: false,
        touchedIndices: new Set<number>(),
      },
    })
    const tile = wrapper.get('[data-file-index="0"]')

    expect(tile.attributes('aria-disabled')).toBeUndefined()
    expect(tile.classes()).not.toContain('opacity-40')
  })

  it('shows six columns from lg in the wider modal', async () => {
    const wrapper = await mountSuspended(GridView, {
      props: {
        files: [file],
        selectedIds: new Set<string>(),
        isTouchSelecting: false,
        touchedIndices: new Set<number>(),
      },
    })

    expect(wrapper.classes()).toEqual(expect.arrayContaining([
      'grid',
      'grid-cols-3',
      'sm:grid-cols-4',
      'lg:grid-cols-6',
    ]))
  })

  it('keeps the skeleton on the same columns with full rows at every width', async () => {
    const wrapper = await mountSuspended(GridSkeleton)
    const tiles = wrapper.findAll('.skeleton')

    expect(wrapper.classes()).toEqual(expect.arrayContaining([
      'grid-cols-3',
      'sm:grid-cols-4',
      'lg:grid-cols-6',
    ]))
    expect(tiles).toHaveLength(12)
    expect(tiles.filter((tile) => {
      return tile.classes().includes('max-sm:hidden')
    })).toHaveLength(3)
    expect(tiles.every(tile => tile.classes().includes('skeleton--default')))
      .toBe(true)
  })
})
