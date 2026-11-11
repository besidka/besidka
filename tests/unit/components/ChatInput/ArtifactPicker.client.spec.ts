import { nextTick, ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactSummary } from '#shared/utils/artifacts'
import ArtifactPicker from '../../../../app/components/ChatInput/ArtifactPicker.client.vue'
import {
  ARTIFACT_LIBRARY_SEARCH_DEBOUNCE_MS,
  ARTIFACT_LIBRARY_SKELETON_DELAY_MS,
} from '../../../../app/composables/artifacts-library'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  lazyFetch: vi.fn(),
  errorMessage: vi.fn(),
  isDesktop: true,
}))

const lazyData = ref<Record<string, any> | undefined>(undefined)
const lazyStatus = ref<string>('success')
const lazyError = ref<unknown>(null)
const lazyRefresh = vi.fn()

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)
mockNuxtImport('useDevice', () => {
  return () => ({ isDesktop: mocks.isDesktop })
})
mockNuxtImport('useLazyFetch', () => {
  return (url: string, options: unknown) => {
    mocks.lazyFetch(url, options)

    return {
      data: lazyData,
      status: lazyStatus,
      error: lazyError,
      refresh: lazyRefresh,
    }
  }
})

enableAutoUnmount(afterEach)

function createArtifact(
  id: string,
  overrides: Partial<ArtifactSummary> = {},
): ArtifactSummary {
  return {
    id,
    title: `Artifact ${id}`,
    kind: 'html',
    currentVersion: 1,
    versionCount: 1,
    updatedAt: '2026-11-09T08:00:00.000Z',
    originChatSlug: null,
    originChatTitle: null,
    createdVia: 'chat',
    activeShareCount: 0,
    takenDown: false,
    ...overrides,
  }
}

function setPage(items: ArtifactSummary[], total = items.length) {
  lazyData.value = { items, total, usedBytes: 0 }
}

function mountPicker(open = true) {
  return mountSuspended(ArtifactPicker, {
    props: { 'open': open, 'onUpdate:open': () => undefined },
    attachTo: document.body,
    global: {
      stubs: {
        Teleport: true,
        UiLocalDate: true,
      },
    },
  })
}

function testId(id: string) {
  return `[data-testid="${id}"]`
}

function lastQuery() {
  const options = mocks.lazyFetch.mock.calls.at(-1)?.[1] as {
    query: { value: Record<string, unknown> }
  }

  return options.query.value
}

describe('ChatInput/ArtifactPicker', () => {
  let showModal: ReturnType<typeof vi.spyOn>
  let closeDialog: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useRealTimers()
    mocks.fetch.mockReset()
    mocks.lazyFetch.mockClear()
    mocks.errorMessage.mockClear()
    mocks.isDesktop = true
    lazyData.value = undefined
    lazyStatus.value = 'success'
    lazyError.value = null
    lazyRefresh.mockReset()
    showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      })
    closeDialog = vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
  })

  afterEach(() => {
    showModal.mockRestore()
    closeDialog.mockRestore()
    vi.useRealTimers()
  })

  it('uses its own fetch key, a page-size limit and no filter at first',
    async () => {
      setPage([createArtifact('a1')])
      await mountPicker()

      expect(mocks.lazyFetch).toHaveBeenCalledWith(
        '/api/v1/artifacts',
        expect.objectContaining({ key: 'artifact-picker' }),
      )
      expect(lastQuery()).toEqual({ limit: 20 })
    })

  it('opens as a modal dialog and focuses the box, not the search, on touch',
    async () => {
      mocks.isDesktop = false
      setPage([createArtifact('a1')])

      const wrapper = await mountPicker()
      const box = wrapper.get('.modal-box').element

      expect(showModal).toHaveBeenCalledTimes(1)
      expect(document.activeElement).toBe(box)
      expect(wrapper.get('input').element).not.toBe(document.activeElement)
      expect(wrapper.get(testId('artifact-picker-dialog')).classes())
        .toEqual(expect.arrayContaining(['modal', 'modal-bottom']))
    })

  it('releases the search field from inert right after opening', async () => {
    setPage([createArtifact('a1')])

    const wrapper = await mountPicker()
    const searchWrap = wrapper.get('input').element.closest('div')!

    expect(searchWrap.hasAttribute('inert')).toBe(false)
  })

  it('focuses the search field on desktop', async () => {
    setPage([createArtifact('a1')])

    const wrapper = await mountPicker()

    expect(document.activeElement).toBe(wrapper.get('input').element)
  })

  it('does not open the dialog while the model is false', async () => {
    await mountPicker(false)

    expect(showModal).not.toHaveBeenCalled()
  })

  it('lists the artifacts with title, kind and version', async () => {
    setPage([
      createArtifact('a1', { title: 'Quiz' }),
      createArtifact('a2', {
        title: 'Flow',
        kind: 'mermaid',
        currentVersion: 4,
        versionCount: 4,
        originChatSlug: 'chat-x',
        originChatTitle: 'Release planning',
      }),
      createArtifact('a3', { title: 'Orphan' }),
    ])

    const wrapper = await mountPicker()
    const rows = wrapper.findAll(testId('artifact-row'))

    expect(rows).toHaveLength(3)
    expect(rows[1]!.text()).toContain('Flow')
    expect(rows[1]!.text()).toContain('Mermaid')
    expect(rows[1]!.text()).toContain('v4 · 4 versions')
    expect(rows[1]!.text()).toContain('Release planning')
    expect(rows[2]!.text()).toContain('Chat deleted')
    expect(wrapper.find(testId('artifact-row-actions-trigger')).exists())
      .toBe(false)
  })

  it('emits pick and asks to close when a row is clicked', async () => {
    const artifact = createArtifact('a1', { title: 'Quiz' })

    setPage([artifact])

    const wrapper = await mountPicker()

    await wrapper.get(testId('artifact-row-open')).trigger('click')

    expect(wrapper.emitted('pick')).toEqual([[artifact]])
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('closes from the close button and reports it', async () => {
    setPage([createArtifact('a1')])

    const wrapper = await mountPicker()

    await wrapper.get(testId('artifact-picker-close')).trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('shows skeleton rows after the delay while the first page loads',
    async () => {
      vi.useFakeTimers()
      lazyStatus.value = 'pending'

      const wrapper = await mountPicker()

      expect(wrapper.find(testId('artifact-picker-skeleton')).exists())
        .toBe(false)

      await vi.advanceTimersByTimeAsync(ARTIFACT_LIBRARY_SKELETON_DELAY_MS)

      expect(wrapper.find(testId('artifact-picker-skeleton')).exists())
        .toBe(true)
      expect(wrapper.find(testId('artifact-picker-list')).exists())
        .toBe(false)
    })

  it('shows the empty state when there are no artifacts', async () => {
    setPage([])

    const wrapper = await mountPicker()

    expect(wrapper.get(testId('artifact-picker-empty')).text())
      .toContain('No artifacts yet')
  })

  it('shows an error with Retry that refreshes', async () => {
    lazyError.value = new Error('boom')

    const wrapper = await mountPicker()

    expect(wrapper.find(testId('artifact-picker-error')).exists()).toBe(true)

    await wrapper.get(testId('artifact-picker-retry')).trigger('click')

    expect(lazyRefresh).toHaveBeenCalled()
  })

  it('filters by kind and marks the pressed button', async () => {
    setPage([createArtifact('a1')])

    const wrapper = await mountPicker()

    expect(wrapper.get(testId('artifact-picker-kind-all'))
      .attributes('aria-pressed')).toBe('true')

    await wrapper.get(testId('artifact-picker-kind-mermaid'))
      .trigger('click')
    await nextTick()

    expect(wrapper.get(testId('artifact-picker-kind-mermaid'))
      .attributes('aria-pressed')).toBe('true')
    expect(lastQuery()).toEqual({ limit: 20, kind: 'mermaid' })
  })

  it('searches after the debounce and says when nothing matches',
    async () => {
      vi.useFakeTimers()
      setPage([createArtifact('a1')])

      const wrapper = await mountPicker()

      await wrapper.get('input').setValue('quiz')
      await vi.advanceTimersByTimeAsync(ARTIFACT_LIBRARY_SEARCH_DEBOUNCE_MS)

      expect(lastQuery()).toEqual({ limit: 20, query: 'quiz' })

      setPage([])
      await nextTick()

      expect(wrapper.get(testId('artifact-picker-no-results')).text())
        .toContain('Nothing matches "quiz"')

      await wrapper.get(testId('artifact-picker-clear')).trigger('click')
      await nextTick()

      expect(lastQuery()).toEqual({ limit: 20 })
    })

  it('loads the next page with the current offset', async () => {
    setPage([createArtifact('a1'), createArtifact('a2')], 3)
    mocks.fetch.mockResolvedValue({
      items: [createArtifact('a3')],
      total: 3,
      usedBytes: 0,
    })

    const wrapper = await mountPicker()

    await wrapper.get(testId('artifact-picker-load-more')).trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/artifacts', {
      query: { limit: 20, offset: 2 },
    })
    expect(wrapper.findAll(testId('artifact-row'))).toHaveLength(3)
    expect(wrapper.find(testId('artifact-picker-load-more')).exists())
      .toBe(false)
  })

  it('cannot pick a taken-down artifact', async () => {
    setPage([createArtifact('a1', { takenDown: true })])

    const wrapper = await mountPicker()

    expect(wrapper.get(testId('artifact-row-open')).attributes('disabled'))
      .toBeDefined()
    expect(wrapper.get(testId('artifact-row-taken-down-badge')).exists())
      .toBe(true)
  })

  it('refreshes and clears filters when it is opened again', async () => {
    setPage([createArtifact('a1')])

    const wrapper = await mountPicker()

    await wrapper.get(testId('artifact-picker-kind-svg')).trigger('click')
    await nextTick()
    lazyRefresh.mockClear()

    await wrapper.setProps({ open: false })
    await flushPromises()
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(lastQuery()).toEqual({ limit: 20 })
    expect(showModal).toHaveBeenCalledTimes(2)
  })

  it('refreshes the list on reopening with no filter', async () => {
    setPage([createArtifact('a1')])

    const wrapper = await mountPicker()

    lazyRefresh.mockClear()
    await wrapper.setProps({ open: false })
    await flushPromises()
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(lazyRefresh).toHaveBeenCalledTimes(1)
  })
})
