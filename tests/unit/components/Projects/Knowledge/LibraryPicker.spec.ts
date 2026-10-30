import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LibraryPicker from '../../../../../app/components/Projects/Knowledge/LibraryPicker.client.vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)

enableAutoUnmount(afterEach)

function libraryFile(id: string, name: string, type: string, size = 2048) {
  return {
    id,
    storageKey: `key-${id}`,
    name,
    size,
    type,
    source: 'upload',
    expiresAt: null,
    createdAt: new Date().toISOString(),
    originModel: null,
    generationCost: null,
  }
}

const libraryFiles = [
  libraryFile('1', 'spec.pdf', 'application/pdf'),
  libraryFile('2', 'photo.png', 'image/png'),
  libraryFile('3', 'anim.gif', 'image/gif'),
  libraryFile('4', 'notes.txt', 'text/plain'),
]

async function mountPicker(props: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(LibraryPicker, {
    props: { open: false, ...props },
    global: {
      stubs: { Teleport: true },
    },
  })

  await wrapper.setProps({ open: true })
  await flushPromises()

  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountPicker>>

function byTestId(wrapper: Wrapper, id: string) {
  return wrapper.get(`[data-testid="${id}"]`)
}

describe('Projects/Knowledge/LibraryPicker', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.fetch.mockResolvedValue({
      files: libraryFiles,
      total: 4,
      offset: 0,
      limit: 50,
    })
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function () {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function () {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('opens a named dialog and loads uploaded files with a query object',
    async () => {
      const wrapper = await mountPicker()

      expect(wrapper.get('dialog').attributes('aria-labelledby'))
        .toBe(wrapper.get('h3').attributes('id'))
      expect(wrapper.get('h3').text()).toBe('Add from my library')
      expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/files', {
        query: { offset: 0, limit: 50, source: 'library' },
      })
    })

  it('lists only PDFs and the supported image types', async () => {
    const wrapper = await mountPicker()
    const names = wrapper.findAll('ul[aria-label="Library files"] li')
      .map(item => item.text())

    expect(names).toHaveLength(2)
    expect(names[0]).toContain('spec.pdf')
    expect(names[1]).toContain('photo.png')
  })

  it('labels the search field', async () => {
    const wrapper = await mountPicker()
    const search = byTestId(wrapper, 'knowledge-library-search')

    expect(wrapper.get(`label[for="${search.attributes('id')}"]`).text())
      .toBe('Search PDFs and images')
  })

  it('searches by name after a pause', async () => {
    const wrapper = await mountPicker()

    mocks.fetch.mockClear()
    await byTestId(wrapper, 'knowledge-library-search').setValue('spec')
    await new Promise(resolve => setTimeout(resolve, 400))
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/files', {
      query: { offset: 0, limit: 50, source: 'library', search: 'spec' },
    })
  })

  it('selects files and emits them on confirm', async () => {
    const wrapper = await mountPicker()

    expect(byTestId(wrapper, 'knowledge-library-add').classes())
      .toContain('btn-disabled')

    await byTestId(wrapper, 'knowledge-library-file-1').setValue(true)
    await byTestId(wrapper, 'knowledge-library-file-2').setValue(true)

    expect(byTestId(wrapper, 'knowledge-library-add').text())
      .toBe('Add 2 files')

    await byTestId(wrapper, 'knowledge-library-add').trigger('click')

    const emitted = wrapper.emitted('select')?.[0]?.[0] as Array<{
      id: string
    }>

    expect(emitted.map(file => file.id)).toEqual(['1', '2'])
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('shows an empty state', async () => {
    mocks.fetch.mockResolvedValue({
      files: [],
      total: 0,
      offset: 0,
      limit: 50,
    })

    const wrapper = await mountPicker()

    expect(byTestId(wrapper, 'knowledge-library-empty').text())
      .toBe('No PDFs or images found in your library.')
  })

  it('shows a load failure inline', async () => {
    mocks.fetch.mockRejectedValue(Object.assign(new Error('Failed'), {
      data: {
        statusCode: 500,
        message: 'Library unavailable',
        data: { why: 'Database is down' },
      },
    }))

    const wrapper = await mountPicker()
    const alert = byTestId(wrapper, 'knowledge-library-error')

    expect(alert.attributes('role')).toBe('alert')
    expect(alert.text()).toContain('Library unavailable')
    expect(alert.text()).toContain('Database is down')
  })

  it('loads the next page from the server offset', async () => {
    mocks.fetch.mockResolvedValueOnce({
      files: libraryFiles,
      total: 6,
      offset: 0,
      limit: 50,
    })

    const wrapper = await mountPicker()

    mocks.fetch.mockResolvedValueOnce({
      files: [libraryFile('5', 'more.pdf', 'application/pdf')],
      total: 6,
      offset: 4,
      limit: 50,
    })
    await byTestId(wrapper, 'knowledge-library-more').trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenLastCalledWith('/api/v1/files', {
      query: { offset: 4, limit: 50, source: 'library' },
    })
    expect(wrapper.findAll('ul[aria-label="Library files"] li'))
      .toHaveLength(3)
  })

  describe('files that are already linked', () => {
    it('disables them, labels them and keeps them unselectable', async () => {
      const wrapper = await mountPicker({ linkedFileIds: ['1'] })
      const linked = byTestId(wrapper, 'knowledge-library-file-1')

      expect(linked.attributes('disabled')).toBeDefined()
      expect(byTestId(wrapper, 'knowledge-library-linked-1').text())
        .toBe('Already added')
      expect(wrapper.find('[data-testid="knowledge-library-linked-2"]')
        .exists()).toBe(false)
      expect(byTestId(wrapper, 'knowledge-library-file-2')
        .attributes('disabled')).toBeUndefined()

      await linked.trigger('change')

      expect(byTestId(wrapper, 'knowledge-library-add').classes())
        .toContain('btn-disabled')

      await byTestId(wrapper, 'knowledge-library-file-2').setValue(true)
      await byTestId(wrapper, 'knowledge-library-add').trigger('click')

      const emitted = wrapper.emitted('select')?.[0]?.[0] as Array<{
        id: string
      }>

      expect(emitted.map(file => file.id)).toEqual(['2'])
    })

    it('treats every file as selectable by default', async () => {
      const wrapper = await mountPicker()

      expect(byTestId(wrapper, 'knowledge-library-file-1')
        .attributes('disabled')).toBeUndefined()
      expect(wrapper.find('[data-testid^="knowledge-library-linked-"]')
        .exists()).toBe(false)
    })
  })

  describe('pages without a supported type', () => {
    const unsupportedPage = (offset: number) => ({
      files: Array.from({ length: 50 }, (_file, index) => {
        return libraryFile(
          `n-${offset + index}`,
          `note-${offset + index}.txt`,
          'text/plain',
        )
      }),
      total: 400,
      offset,
      limit: 50,
    })

    it('loads the next page instead of showing an empty state', async () => {
      mocks.fetch
        .mockResolvedValueOnce(unsupportedPage(0))
        .mockResolvedValueOnce({
          files: [libraryFile('9', 'late.pdf', 'application/pdf')],
          total: 51,
          offset: 50,
          limit: 50,
        })

      const wrapper = await mountPicker()

      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      expect(mocks.fetch).toHaveBeenLastCalledWith('/api/v1/files', {
        query: { offset: 50, limit: 50, source: 'library' },
      })
      expect(wrapper.find('[data-testid="knowledge-library-empty"]')
        .exists()).toBe(false)
      expect(wrapper.findAll('ul[aria-label="Library files"] li'))
        .toHaveLength(1)
    })

    it('shows the empty state once the pages are exhausted', async () => {
      mocks.fetch
        .mockResolvedValueOnce(unsupportedPage(0))
        .mockResolvedValueOnce({
          files: Array.from({ length: 10 }, (_file, index) => {
            return libraryFile(`t-${index}`, `t-${index}.txt`, 'text/plain')
          }),
          total: 60,
          offset: 50,
          limit: 50,
        })

      const wrapper = await mountPicker()

      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      expect(byTestId(wrapper, 'knowledge-library-empty').text())
        .toBe('No PDFs or images found in your library.')
      expect(wrapper.find('[data-testid="knowledge-library-more"]')
        .exists()).toBe(false)
    })

    it('stops after five pages and keeps Load more available', async () => {
      mocks.fetch.mockImplementation((_url, options) => {
        return Promise.resolve(unsupportedPage(options.query.offset))
      })

      const wrapper = await mountPicker()

      expect(mocks.fetch).toHaveBeenCalledTimes(5)
      expect(wrapper.find('[data-testid="knowledge-library-empty"]')
        .exists()).toBe(false)
      expect(byTestId(wrapper, 'knowledge-library-empty-so-far').text())
        .toBe('No PDFs or images in the files checked so far.')
      expect(byTestId(wrapper, 'knowledge-library-more').exists()).toBe(true)

      mocks.fetch.mockResolvedValueOnce({
        files: [libraryFile('7', 'next.pdf', 'application/pdf')],
        total: 251,
        offset: 250,
        limit: 50,
      })
      await byTestId(wrapper, 'knowledge-library-more').trigger('click')
      await flushPromises()

      expect(mocks.fetch).toHaveBeenLastCalledWith('/api/v1/files', {
        query: { offset: 250, limit: 50, source: 'library' },
      })
      expect(wrapper.findAll('ul[aria-label="Library files"] li'))
        .toHaveLength(1)
    })

    it('does not auto-load when the first page already has files',
      async () => {
        mocks.fetch.mockResolvedValue({
          files: libraryFiles,
          total: 400,
          offset: 0,
          limit: 50,
        })

        await mountPicker()

        expect(mocks.fetch).toHaveBeenCalledTimes(1)
      })
  })
})
