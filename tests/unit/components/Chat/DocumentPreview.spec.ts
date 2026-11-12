import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ChatDocumentPreview from '../../../../app/components/Chat/DocumentPreview.vue'

enableAutoUnmount(afterEach)

const state = vi.hoisted(() => ({
  spec: { value: null as unknown },
  specStatus: { value: 'success' as string },
  specError: { value: null as unknown },
  statusData: { value: null as unknown },
  statusRequest: { value: 'success' as string },
  statusError: { value: null as unknown },
  requests: [] as string[],
  refreshSpec: vi.fn(),
  refreshStatus: vi.fn(),
}))

mockNuxtImport('useLazyFetch', () => {
  return (url: () => string) => {
    const resolved = url()

    state.requests.push(resolved)

    if (resolved.endsWith('/spec')) {
      return {
        data: { get value() {
          return state.spec.value
        } },
        status: { get value() {
          return state.specStatus.value
        } },
        error: { get value() {
          return state.specError.value
        } },
        refresh: state.refreshSpec,
      }
    }

    return {
      data: { get value() {
        return state.statusData.value
      } },
      status: { get value() {
        return state.statusRequest.value
      } },
      error: { get value() {
        return state.statusError.value
      } },
      refresh: state.refreshStatus,
    }
  }
})

mockNuxtImport('getDocumentFileUrls', () => {
  return (file: { id: string }) => ({
    viewUrl: `/api/v1/files/${file.id}/view`,
    downloadUrl: `/api/v1/files/${file.id}/download`,
  })
})

function testId(id: string) {
  return `[data-testid="${id}"]`
}

function run(text: string, extra: Record<string, unknown> = {}) {
  return { text, ...extra }
}

const DOCX_SPEC = {
  specVersion: 1,
  format: 'docx',
  title: 'Plan',
  blocks: [
    { type: 'heading', level: 1, text: 'Overview' },
    {
      type: 'paragraph',
      runs: [
        run('Plain '),
        run('bold', { bold: true }),
        run(' and '),
        run('italic', { italic: true }),
        run(' with '),
        run('a safe link', { link: { href: 'https://example.com/page' } }),
        run(' and '),
        run('an unsafe link', { link: { href: 'javascript:alert(1)' } }),
      ],
    },
    {
      type: 'list',
      ordered: false,
      items: [
        { runs: [run('First')], children: [{ runs: [run('Nested')] }] },
        { runs: [run('Second')] },
      ],
    },
    {
      type: 'table',
      header: true,
      columns: [{ text: 'Name' }, { text: 'Amount', align: 'right' }],
      rows: [[[run('Rent')], [run('1200')]]],
    },
    { type: 'quote', runs: [run('A wise quote')] },
    { type: 'code', text: 'const answer = 42', language: 'ts' },
    { type: 'pageBreak' },
  ],
}

const PPTX_SPEC = {
  specVersion: 1,
  format: 'pptx',
  title: 'Deck',
  aspect: '16:9',
  slides: [
    { layout: 'title', title: 'Welcome', subtitle: 'Kickoff' },
    {
      layout: 'title-content',
      title: 'Agenda',
      bullets: [[run('Goals')], [run('Timeline')]],
      notes: 'Mention the budget first.',
    },
  ],
}

function buildXlsxSpec(rowCount: number) {
  return {
    specVersion: 1,
    format: 'xlsx',
    title: 'Budget',
    sheets: [
      {
        name: 'Q1',
        columns: [
          { header: 'Item', type: 'string' },
          { header: 'Cost', type: 'currency' },
        ],
        rows: Array.from({ length: rowCount }, (_, rowIndex) => {
          return [`Item ${rowIndex + 1}`, rowIndex + 1]
        }),
      },
      {
        name: 'Q2',
        columns: [{ header: 'Date', type: 'date' }],
        rows: [[{ date: '2026-11-08' }], [{ formula: 'A1+1', cached: 5 }]],
      },
    ],
  }
}

function mountPreview(props: Record<string, unknown>) {
  return mountSuspended(ChatDocumentPreview, {
    props: { documentId: 'doc_1', title: 'Plan', ...props },
  })
}

beforeEach(() => {
  state.spec.value = null
  state.specStatus.value = 'success'
  state.specError.value = null
  state.statusData.value = null
  state.statusRequest.value = 'success'
  state.statusError.value = null
  state.requests.length = 0
  state.refreshSpec.mockReset()
  state.refreshStatus.mockReset()
})

describe('ChatDocumentPreview', () => {
  describe('pdf', () => {
    const props = {
      format: 'pdf',
      viewUrl: '/api/v1/files/f1/view',
      downloadUrl: '/api/v1/files/f1/download',
    }

    it('embeds the same-origin file with an accessible name', async () => {
      const wrapper = await mountPreview(props)
      const frame = wrapper.get(testId('document-preview-pdf'))

      expect(frame.element.tagName).toBe('IFRAME')
      expect(frame.attributes('src')).toBe('/api/v1/files/f1/view')
      expect(frame.attributes('title')).toBe('Plan PDF preview')
    })

    it('offers an Open in a new tab link as the iOS fallback', async () => {
      const wrapper = await mountPreview(props)
      const link = wrapper.get(testId('document-preview-new-tab'))

      expect(link.attributes('href')).toBe('/api/v1/files/f1/view')
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toContain('noopener')
      expect(link.text()).toContain('Open in a new tab')
    })

    it('has a header with the format badge, title and Download', async () => {
      const wrapper = await mountPreview(props)

      expect(wrapper.get(testId('document-preview-format')).text())
        .toBe('PDF')
      expect(wrapper.get(testId('document-preview-title')).text())
        .toBe('Plan')
      expect(wrapper.get(testId('document-preview-download'))
        .attributes('href')).toBe('/api/v1/files/f1/download')
    })

    it('omits the non-PDF outline note', async () => {
      const wrapper = await mountPreview(props)

      expect(wrapper.find(testId('document-preview-note')).exists())
        .toBe(false)
    })

    it('resolves the file urls from the status when none are passed',
      async () => {
        state.statusData.value = {
          file: { id: 'file_7', name: 'x.pdf', size: 1, type: 'a', storageKey: 'k' },
        }

        const wrapper = await mountPreview({ format: 'pdf' })

        expect(wrapper.get(testId('document-preview-pdf')).attributes('src'))
          .toBe('/api/v1/files/file_7/view')
      })

    it('shows a skeleton while the file urls load', async () => {
      state.statusRequest.value = 'pending'

      const wrapper = await mountPreview({ format: 'pdf' })

      expect(wrapper.get(testId('document-preview-loading')).html())
        .toContain('skeleton skeleton--default')
    })

    it('shows an error with a retry when the status request fails',
      async () => {
        state.statusError.value = { data: { message: 'Server is down' } }

        const wrapper = await mountPreview({ format: 'pdf' })

        expect(wrapper.get(testId('document-preview-error')).text())
          .toContain('Server is down')

        await wrapper.get(testId('document-preview-retry')).trigger('click')

        expect(state.refreshStatus).toHaveBeenCalledTimes(1)
      })
  })

  describe('docx', () => {
    const props = {
      format: 'docx',
      viewUrl: '/v',
      downloadUrl: '/d',
    }

    it('renders the outline with headings, paragraphs and lists', async () => {
      state.spec.value = DOCX_SPEC

      const wrapper = await mountPreview(props)
      const outline = wrapper.get(testId('document-preview-outline'))

      expect(outline.get('h4').text()).toBe('Overview')
      expect(outline.get(testId('document-block-paragraph')).text())
        .toContain('Plain bold and italic')
      expect(outline.get('strong, .font-bold').text()).toBe('bold')
      expect(outline.get('.italic').text()).toBe('italic')
      expect(outline.findAll('ul')).toHaveLength(2)
      expect(outline.get(testId('document-block-list')).text())
        .toContain('Nested')
      expect(outline.get('blockquote').text()).toBe('A wise quote')
      expect(outline.get('pre code').text()).toBe('const answer = 42')
      expect(outline.find('hr').exists()).toBe(true)
    })

    it('renders tables with header cells scoped to columns', async () => {
      state.spec.value = DOCX_SPEC

      const wrapper = await mountPreview(props)
      const table = wrapper.get(testId('document-block-table'))

      expect(table.classes()).toContain('overflow-x-auto')
      expect(table.get('table').classes())
        .toEqual(expect.arrayContaining(['table', 'table-zebra']))
      expect(table.findAll('th').map(cell => cell.attributes('scope')))
        .toEqual(['col', 'col'])
      expect(table.get('td').text()).toBe('Rent')
    })

    it('links only allowed hyperlinks and hardens them', async () => {
      state.spec.value = DOCX_SPEC

      const wrapper = await mountPreview(props)
      const links = wrapper.findAll(`${testId('document-preview-outline')} a`)

      expect(links).toHaveLength(1)
      expect(links[0]?.attributes('href')).toBe('https://example.com/page')
      expect(links[0]?.attributes('target')).toBe('_blank')
      expect(links[0]?.attributes('rel'))
        .toBe('noopener noreferrer nofollow')
      expect(wrapper.text()).toContain('an unsafe link')
      expect(wrapper.html()).not.toContain('javascript:')
    })

    it('labels the preview as an outline for non-PDF formats', async () => {
      state.spec.value = DOCX_SPEC

      const wrapper = await mountPreview(props)

      expect(wrapper.get(testId('document-preview-note')).text())
        .toBe('Preview from the document outline; download for exact layout')
    })

    it('shows a skeleton while the spec loads', async () => {
      state.specStatus.value = 'pending'

      const wrapper = await mountPreview(props)

      expect(wrapper.get(testId('document-preview-loading')).html())
        .toContain('skeleton skeleton--default')
    })

    it('shows an error and refreshes the spec on retry', async () => {
      state.specError.value = { data: { message: 'Spec is gone' } }
      state.specStatus.value = 'error'

      const wrapper = await mountPreview(props)

      expect(wrapper.get(testId('document-preview-error')).text())
        .toContain('Spec is gone')

      await wrapper.get(testId('document-preview-retry')).trigger('click')

      expect(state.refreshSpec).toHaveBeenCalledTimes(1)
    })

    it.each([404, 410])(
      'shows the unavailable state without a retry when the spec is gone (%i)',
      async (statusCode) => {
        state.specError.value = {
          statusCode,
          data: { message: 'The document spec is gone' },
        }
        state.specStatus.value = 'error'

        const wrapper = await mountPreview(props)

        expect(wrapper.get(testId('document-preview-unavailable')).text())
          .toContain('Preview unavailable')
        expect(wrapper.find(testId('document-preview-error')).exists())
          .toBe(false)
        expect(wrapper.find(testId('document-preview-retry')).exists())
          .toBe(false)
        expect(wrapper.find(testId('document-preview-note')).exists())
          .toBe(false)
        expect(wrapper.find(testId('document-preview-download')).exists())
          .toBe(true)
      },
    )

    it('renders the header-actions slot', async () => {
      state.spec.value = DOCX_SPEC

      const wrapper = await mountSuspended(ChatDocumentPreview, {
        props: { documentId: 'doc_1', title: 'Plan', ...props },
        slots: {
          'header-actions': '<button data-testid="extra">Extra</button>',
        },
      })

      expect(wrapper.find(testId('extra')).exists()).toBe(true)
    })
  })

  describe('pptx', () => {
    const props = { format: 'pptx', viewUrl: '/v', downloadUrl: '/d' }

    it('renders 16:9 slide cards', async () => {
      state.spec.value = PPTX_SPEC

      const wrapper = await mountPreview(props)
      const cards = wrapper.findAll(testId('document-slide-card'))

      expect(cards).toHaveLength(2)
      expect(cards[0]?.classes())
        .toEqual(expect.arrayContaining(['card', 'aspect-video', 'bg-base-200']))
      expect(cards[0]?.text()).toContain('Welcome')
      expect(cards[0]?.text()).toContain('Kickoff')
      expect(cards[1]?.findAll('li').map(item => item.text()))
        .toEqual(['Goals', 'Timeline'])
    })

    it('toggles speaker notes per slide', async () => {
      state.spec.value = PPTX_SPEC

      const wrapper = await mountPreview(props)
      const toggles = wrapper.findAll(testId('document-slide-notes-toggle'))

      expect(toggles).toHaveLength(1)
      expect(toggles[0]?.attributes('aria-expanded')).toBe('false')
      expect(wrapper.find(testId('document-slide-notes')).exists())
        .toBe(false)

      await toggles[0]?.trigger('click')

      expect(toggles[0]?.attributes('aria-expanded')).toBe('true')
      expect(wrapper.get(testId('document-slide-notes')).text())
        .toBe('Mention the budget first.')

      await toggles[0]?.trigger('click')

      expect(wrapper.find(testId('document-slide-notes')).exists())
        .toBe(false)
    })
  })

  describe('xlsx', () => {
    const props = { format: 'xlsx', viewUrl: '/v', downloadUrl: '/d' }

    it('renders one tab per sheet and switches the table', async () => {
      state.spec.value = buildXlsxSpec(3)

      const wrapper = await mountPreview(props)
      const tabs = wrapper.findAll('[role="tab"]')

      expect(wrapper.get(testId('document-sheet-tabs')).classes())
        .toEqual(expect.arrayContaining(['tabs', 'tabs-box']))
      expect(tabs.map(tab => tab.text())).toEqual(['Q1', 'Q2'])
      expect(tabs[0]?.attributes('aria-selected')).toBe('true')
      expect(wrapper.get('table').classes())
        .toEqual(expect.arrayContaining([
          'table',
          'table-zebra',
          'table-pin-rows',
        ]))
      expect(wrapper.findAll('th').map(cell => cell.attributes('scope')))
        .toEqual(['col', 'col'])
      expect(wrapper.findAll(testId('document-sheet-row'))).toHaveLength(3)

      await tabs[1]?.trigger('click')

      expect(tabs[1]?.attributes('aria-selected')).toBe('true')
      expect(wrapper.findAll('td').map(cell => cell.text()))
        .toEqual(['2026-11-08', '5'])
    })

    it('moves between tabs with the arrow keys', async () => {
      state.spec.value = buildXlsxSpec(2)

      const wrapper = await mountPreview(props)

      await wrapper.get('[role="tablist"]').trigger('keydown', {
        key: 'ArrowRight',
      })

      expect(wrapper.findAll('[role="tab"]')[1]?.attributes('aria-selected'))
        .toBe('true')
    })

    it('shows only the first 1,000 rows with a count note', async () => {
      state.spec.value = buildXlsxSpec(1500)

      const wrapper = await mountPreview(props)

      expect(wrapper.findAll(testId('document-sheet-row'))).toHaveLength(1000)
      expect(wrapper.get(testId('document-sheet-row-limit')).text())
        .toBe('Showing 1,000 of 1,500 rows')
    })

    it('shows no row note at or under the limit', async () => {
      state.spec.value = buildXlsxSpec(1000)

      const wrapper = await mountPreview(props)

      expect(wrapper.findAll(testId('document-sheet-row'))).toHaveLength(1000)
      expect(wrapper.find(testId('document-sheet-row-limit')).exists())
        .toBe(false)
    })

    it('scrolls the table horizontally inside its own container', async () => {
      state.spec.value = buildXlsxSpec(2)

      const wrapper = await mountPreview(props)

      expect(wrapper.get(testId('document-sheet-table')).classes())
        .toEqual(expect.arrayContaining(['max-w-full', 'overflow-auto']))
    })
  })

  it('never uses v-html in the preview components', () => {
    const directory = resolve(
      __dirname,
      '../../../../app/components/Chat',
    )
    const files = [
      'DocumentPreview.vue',
      'Document.vue',
      'Document/Blocks.vue',
      'Document/List.vue',
      'Document/Runs.vue',
      'Document/Sheets.vue',
      'Document/Slide.vue',
    ]

    for (const file of files) {
      expect(readFileSync(resolve(directory, file), 'utf8'))
        .not.toContain('v-html')
    }
  })

  it('ignores a spec whose format does not match the requested one',
    async () => {
      state.spec.value = PPTX_SPEC

      const wrapper = await mountPreview({
        format: 'docx',
        viewUrl: '/v',
        downloadUrl: '/d',
      })

      expect(wrapper.find(testId('document-preview-slides')).exists())
        .toBe(false)
      expect(wrapper.get(testId('document-preview-error')).text())
        .toContain('not available')
    })
})
