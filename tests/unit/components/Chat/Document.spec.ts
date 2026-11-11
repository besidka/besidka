import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatDocument from '../../../../app/components/Chat/Document.vue'
import { useSidePanel } from '../../../../app/composables/side-panel'

enableAutoUnmount(afterEach)

const { featureState, flowStatus, flowDocument, flowError, flowBusy, retry }
  = vi.hoisted(() => ({
    featureState: { enabled: true, active: true, variant: null },
    flowStatus: { value: 'loading' as string },
    flowDocument: { value: null as Record<string, unknown> | null },
    flowError: { value: null as string | null },
    flowBusy: { value: false },
    retry: vi.fn(),
  }))

mockNuxtImport('useFeature', () => {
  return () => ref(featureState)
})

mockNuxtImport('useDocumentFlow', () => {
  return () => ({
    status: { get value() {
      return flowStatus.value
    } },
    document: { get value() {
      return flowDocument.value
    } },
    errorMessage: { get value() {
      return flowError.value
    } },
    isBusy: { get value() {
      return flowBusy.value
    } },
    retry,
    refresh: vi.fn(),
  })
})

mockNuxtImport('getDocumentFileUrls', () => {
  return (file: { id: string }) => ({
    viewUrl: `/api/v1/files/${file.id}/view`,
    downloadUrl: `/api/v1/files/${file.id}/download`,
  })
})

const OWNER_PART = {
  type: 'data-document',
  data: {
    documentId: 'doc_1',
    format: 'docx',
    title: 'Quarterly plan',
    specVersion: 1,
    status: 'spec_ready',
  },
}

const READY_DOCUMENT = {
  id: 'doc_1',
  format: 'docx',
  title: 'Quarterly plan',
  status: 'ready',
  file: {
    id: 'file_1',
    storageKey: 'key',
    name: 'Quarterly plan.docx',
    size: 24576,
    type: 'application/octet-stream',
  },
  stats: { pages: 3, slides: null, sheets: null, cells: null, images: 0 },
}

function streamingPart(input?: Record<string, unknown>) {
  return {
    type: 'tool-create_document',
    toolCallId: 'call_1',
    state: 'input-streaming',
    ...(input ? { input } : {}),
  }
}

function testId(id: string) {
  return `[data-testid="${id}"]`
}

function mountCard(props: Record<string, unknown>, slots = {}) {
  return mountSuspended(ChatDocument, { props, slots })
}

beforeEach(() => {
  useSidePanel().close()
  featureState.active = true
  flowStatus.value = 'loading'
  flowDocument.value = null
  flowError.value = null
  flowBusy.value = false
  retry.mockReset()
})

afterEach(() => {
  useSidePanel().close()
})

describe('ChatDocument', () => {
  it('renders nothing for a part that is not a document', async () => {
    const wrapper = await mountCard({ part: { type: 'text', text: 'hi' } })

    expect(wrapper.find(testId('document-card')).exists()).toBe(false)
  })

  it('shows the streaming outline state with a block count', async () => {
    const wrapper = await mountCard({
      part: streamingPart({
        format: 'docx',
        title: 'Plan',
        blocks: [{ type: 'paragraph' }, { type: 'paragraph' }],
      }),
      isStreaming: true,
    })
    const card = wrapper.get(testId('document-card'))

    expect(card.attributes('data-state')).toBe('streaming')
    expect(wrapper.get(testId('document-card-status')).text())
      .toBe('Writing the outline...')
    expect(wrapper.get(testId('document-card-meta')).text()).toBe('2 blocks')
    expect(wrapper.get(testId('document-card-skeleton')).classes())
      .toEqual(expect.arrayContaining(['skeleton', 'skeleton--default']))
    expect(wrapper.find(testId('document-card-actions')).exists()).toBe(false)
  })

  it('exposes one polite status region that always carries text', async () => {
    const wrapper = await mountCard({ part: OWNER_PART })
    const status = wrapper.get(testId('document-card-status'))

    expect(status.attributes('role')).toBe('status')
    expect(status.attributes('aria-live')).toBe('polite')
    expect(status.text()).not.toBe('')
  })

  it('shows a building state without percentages while the file renders',
    async () => {
      flowStatus.value = 'rendering'

      const wrapper = await mountCard({ part: OWNER_PART })

      expect(wrapper.get(testId('document-card')).attributes('data-state'))
        .toBe('building')
      expect(wrapper.get(testId('document-card-status')).text())
        .toBe('Building DOCX...')
      expect(wrapper.get(testId('document-card-status')).text())
        .not.toMatch(/%/)
      expect(wrapper.find(testId('document-card-actions')).exists())
        .toBe(false)
    })

  it('shows the tool call as building while the tool is running',
    async () => {
      const wrapper = await mountCard({
        part: {
          type: 'tool-create_document',
          toolCallId: 'call_1',
          state: 'input-available',
          input: { format: 'pptx', title: 'Deck', slides: [] },
        },
        isStreaming: true,
      })

      expect(wrapper.get(testId('document-card-status')).text())
        .toBe('Building PPTX...')
    })

  describe('ready', () => {
    beforeEach(() => {
      flowStatus.value = 'ready'
      flowDocument.value = READY_DOCUMENT
    })

    it('shows the title, format badge, pages and size', async () => {
      const wrapper = await mountCard({ part: OWNER_PART })

      expect(wrapper.get(testId('document-card')).attributes('data-state'))
        .toBe('ready')
      expect(wrapper.get(testId('document-card-title')).text())
        .toBe('Quarterly plan')
      expect(wrapper.get(testId('document-card-format')).classes())
        .toEqual(expect.arrayContaining(['badge', 'badge-soft']))
      expect(wrapper.get(testId('document-card-format')).text()).toBe('DOCX')
      expect(wrapper.get(testId('document-card-meta')).text())
        .toContain('3 pages')
      expect(wrapper.get(testId('document-card-status')).text()).toBe('Ready')
    })

    it('counts slides for a presentation', async () => {
      flowDocument.value = {
        ...READY_DOCUMENT,
        format: 'pptx',
        stats: { pages: null, slides: 1, sheets: null, cells: null, images: 0 },
      }

      const wrapper = await mountCard({
        part: {
          ...OWNER_PART,
          data: { ...OWNER_PART.data, format: 'pptx' },
        },
      })

      expect(wrapper.get(testId('document-card-meta')).text())
        .toContain('1 slide')
      expect(wrapper.get(testId('document-card-meta')).text())
        .not.toContain('slides')
    })

    it('links Download to the download url', async () => {
      const wrapper = await mountCard({ part: OWNER_PART })
      const link = wrapper.get(testId('document-card-download'))

      expect(link.element.tagName).toBe('A')
      expect(link.attributes('href')).toBe('/api/v1/files/file_1/download')
      expect(link.attributes('download')).toBeDefined()
    })

    it('opens the preview in the side panel from the Preview button',
      async () => {
        const wrapper = await mountCard({ part: OWNER_PART })
        const button = wrapper.get(testId('document-card-preview'))

        expect(button.element.tagName).toBe('BUTTON')

        await button.trigger('click')

        const view = useSidePanel().currentView.value

        expect(view?.viewKey).toBe('document:doc_1')
        expect(view?.mode).toBe('detail')
        expect(view?.props).toMatchObject({
          documentId: 'doc_1',
          format: 'docx',
          title: 'Quarterly plan',
          viewUrl: '/api/v1/files/file_1/view',
          downloadUrl: '/api/v1/files/file_1/download',
        })
      })

    it('renders the extra actions slot after Preview and Download',
      async () => {
        const wrapper = await mountCard(
          { part: OWNER_PART },
          { extraActions: '<button data-testid="extra">Extra</button>' },
        )
        const actions = wrapper.get(testId('document-card-actions'))

        expect(actions.get(testId('extra')).exists()).toBe(true)
        expect(actions.element.lastElementChild?.getAttribute('data-testid'))
          .toBe('extra')
      })

    it('treats a ready document without a file as unavailable', async () => {
      flowDocument.value = { ...READY_DOCUMENT, file: null }

      const wrapper = await mountCard({ part: OWNER_PART })

      expect(wrapper.get(testId('document-card')).attributes('data-state'))
        .toBe('unavailable')
    })
  })

  describe('failed', () => {
    it('shows the error and retries on Try again', async () => {
      flowStatus.value = 'failed'
      flowError.value = 'The renderer is busy.'

      const wrapper = await mountCard({ part: OWNER_PART })

      expect(wrapper.get(testId('document-card')).attributes('data-state'))
        .toBe('failed')
      expect(wrapper.get(testId('document-card-status')).text())
        .toBe('Document could not be created')
      expect(wrapper.get(testId('document-card-error')).text())
        .toContain('The renderer is busy.')

      await wrapper.get(testId('document-card-retry')).trigger('click')

      expect(retry).toHaveBeenCalledTimes(1)
    })

    it('disables Try again while a retry is running', async () => {
      flowStatus.value = 'failed'
      flowBusy.value = true

      const wrapper = await mountCard({ part: OWNER_PART })

      expect(wrapper.get(testId('document-card-retry')).attributes('disabled'))
        .toBeDefined()
    })

    it('shows a tool failure without a retry button', async () => {
      const wrapper = await mountCard({
        part: {
          type: 'tool-create_document',
          toolCallId: 'call_1',
          state: 'output-error',
          errorText: 'The spec was invalid.',
          input: { format: 'docx', title: 'Plan' },
        },
      })

      expect(wrapper.get(testId('document-card')).attributes('data-state'))
        .toBe('failed')
      expect(wrapper.get(testId('document-card-error')).text())
        .toContain('The spec was invalid.')
      expect(wrapper.find(testId('document-card-retry')).exists()).toBe(false)
    })
  })

  describe('unavailable', () => {
    it('shows a neutral card when the file is gone', async () => {
      flowStatus.value = 'unavailable'

      const wrapper = await mountCard({ part: OWNER_PART })

      expect(wrapper.get(testId('document-card')).attributes('data-state'))
        .toBe('unavailable')
      expect(wrapper.get(testId('document-card-status')).text())
        .toBe('Document unavailable')
      expect(wrapper.find(testId('document-card-error')).exists()).toBe(false)
      expect(wrapper.find(testId('document-card-actions')).exists())
        .toBe(false)
    })

    it('shows the unavailable card when the documents feature is off',
      async () => {
        featureState.active = false
        flowStatus.value = 'ready'
        flowDocument.value = READY_DOCUMENT

        const wrapper = await mountCard({ part: OWNER_PART })

        expect(wrapper.get(testId('document-card')).attributes('data-state'))
          .toBe('unavailable')
        expect(wrapper.find(testId('document-card-download')).exists())
          .toBe(false)
        expect(wrapper.find(testId('document-card-preview')).exists())
          .toBe(false)
      })
  })

  describe('shared view', () => {
    const SHARED_PART = {
      type: 'data-document',
      data: {
        documentId: null,
        format: 'xlsx',
        title: 'Budget',
        specVersion: 1,
        status: 'ready',
      },
    }

    it('shows a title-only card with the format badge', async () => {
      const wrapper = await mountCard({ part: SHARED_PART })

      expect(wrapper.get(testId('document-card')).attributes('data-state'))
        .toBe('shared')
      expect(wrapper.get(testId('document-card-title')).text()).toBe('Budget')
      expect(wrapper.get(testId('document-card-format')).text()).toBe('XLSX')
      expect(wrapper.find(testId('document-card-actions')).exists())
        .toBe(false)
      expect(wrapper.find(testId('document-card-preview')).exists())
        .toBe(false)
    })

    it('offers only Download when the part carries a file', async () => {
      const wrapper = await mountCard({
        part: {
          ...SHARED_PART,
          data: {
            ...SHARED_PART.data,
            file: {
              url: '/shared/slug/files/file_9',
              name: 'Budget.xlsx',
              size: 2048,
              type: 'application/octet-stream',
            },
          },
        },
      })

      expect(wrapper.find(testId('document-card-preview')).exists())
        .toBe(false)
      expect(wrapper.get(testId('document-card-download')).attributes('href'))
        .toBe('/shared/slug/files/file_9')
      expect(wrapper.get(testId('document-card-meta')).text()).toContain('2')
    })

    it('ignores a file url that is not a local path', async () => {
      const wrapper = await mountCard({
        part: {
          ...SHARED_PART,
          data: {
            ...SHARED_PART.data,
            file: {
              url: 'javascript:alert(1)',
              name: 'Budget.xlsx',
              size: 2048,
              type: 'x',
            },
          },
        },
      })

      expect(wrapper.find(testId('document-card-download')).exists())
        .toBe(false)
    })
  })
})
