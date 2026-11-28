import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'
import StoragePage from '../../../../app/pages/profile/storage.vue'

const mocks = vi.hoisted(() => ({
  useLazyFetch: vi.fn(),
  refresh: vi.fn(),
  navigateTo: vi.fn(),
  requestOpen: vi.fn(),
  confirm: vi.fn(),
  fetch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  artifactsActive: { value: true },
  skillsActive: { value: true },
}))

mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)
mockNuxtImport('navigateTo', () => mocks.navigateTo)
mockNuxtImport('useFeature', () => {
  return (flag: string) => computed(() => {
    const active = flag === 'skills'
      ? mocks.skillsActive.value
      : mocks.artifactsActive.value

    return { enabled: active, active }
  })
})
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('useFilesModalHandoff', () => {
  return () => ({ requestOpen: mocks.requestOpen })
})

const MEGABYTE = 1024 * 1024

function createStats(overrides: Record<string, unknown> = {}) {
  const used = 13 * MEGABYTE

  return {
    used,
    total: 20 * MEGABYTE,
    percentage: 65,
    breakdown: {
      totalBytes: used,
      categories: [
        { id: 'aiImages', bytes: 3 * MEGABYTE, count: 4 },
        { id: 'uploads', bytes: 5 * MEGABYTE, count: 1 },
        { id: 'generatedFiles', bytes: 0, count: 0 },
        { id: 'connectorImages', bytes: MEGABYTE, count: 3 },
        { id: 'artifacts', bytes: 2 * MEGABYTE, count: 3 },
        { id: 'knowledge', bytes: 2 * MEGABYTE, count: 9 },
        { id: 'skills', bytes: MEGABYTE, count: 2 },
      ],
    },
    ...overrides,
  }
}

interface MountOptions {
  data?: unknown
  status?: string
  error?: unknown
}

async function mountPage(options: MountOptions = {}) {
  const data = ref('data' in options ? options.data : createStats())

  mocks.useLazyFetch.mockReturnValue({
    data,
    status: ref(options.status ?? 'success'),
    error: ref(options.error ?? null),
    refresh: mocks.refresh,
  })

  return mountSuspended(StoragePage)
}

describe('profile storage page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mocks.useLazyFetch.mockReset()
    mocks.refresh.mockReset().mockResolvedValue(undefined)
    mocks.navigateTo.mockReset().mockResolvedValue(undefined)
    mocks.requestOpen.mockReset()
    mocks.confirm.mockReset()
    mocks.fetch.mockReset()
    mocks.success.mockReset()
    mocks.error.mockReset()
    mocks.artifactsActive.value = true
    mocks.skillsActive.value = true
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deletes connector images from their row instead of managing them',
    async () => {
      mocks.confirm.mockResolvedValue({ label: 'Delete all', index: 0 })
      mocks.fetch
        .mockResolvedValueOnce({ deleted: 1800, failed: 0, hasMore: true })
        .mockResolvedValueOnce({ deleted: 3, failed: 0, hasMore: false })

      const wrapper = await mountPage()
      const row = wrapper.get('[data-testid="storage-category-connectorImages"]')

      expect(row.text()).toContain('Connector images')
      expect(row.find('[data-testid="storage-manage-connectorImages"]')
        .exists()).toBe(false)

      await row.get('[data-testid="storage-delete-connectorImages"]')
        .trigger('click')
      await vi.waitFor(() => {
        expect(mocks.success).toHaveBeenCalledWith(
          'Deleted 1803 connector images',
        )
      })

      expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
        alert: true,
        actions: ['Delete all'],
      }))
      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/storage/connector-images/delete',
        { method: 'POST' },
      )
      expect(mocks.refresh).toHaveBeenCalled()
    })

  it('deletes nothing when the confirmation is declined', async () => {
    mocks.confirm.mockResolvedValue(null)

    const wrapper = await mountPage()

    await wrapper.get('[data-testid="storage-delete-connectorImages"]')
      .trigger('click')
    await vi.waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalled()
    })

    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('reads the storage API with a lazy fetch', async () => {
    await mountPage()

    expect(mocks.useLazyFetch.mock.calls[0]?.slice(0, 2)).toEqual([
      '/api/v1/storage',
      { key: 'profile-storage' },
    ])
  })

  it('shows X of Y used with a daisyUI progress bar', async () => {
    const wrapper = await mountPage()
    const progress = wrapper.get('[data-testid="storage-progress"]')

    expect(wrapper.get('h1').text()).toBe('Storage')
    expect(wrapper.get('[data-testid="storage-usage-text"]').text())
      .toBe('13.0 MB of 20.0 MB used')
    expect(progress.element.tagName).toBe('PROGRESS')
    expect(progress.classes()).toContain('progress')
    expect(progress.classes()).not.toContain('progress-warning')
    expect(progress.classes()).not.toContain('progress-error')
    expect(progress.attributes('value')).toBe('65')
    expect(progress.attributes('max')).toBe('100')
    expect(wrapper.get('[data-testid="storage-percentage"]').text())
      .toBe('65%')
  })

  it('lists every category with size and count', async () => {
    const wrapper = await mountPage()

    expect(wrapper.get('[data-testid="storage-category-aiImages"]').text())
      .toContain('AI images')
    expect(wrapper.get('[data-testid="storage-category-aiImages-summary"]')
      .text()).toBe('3.0 MB · 4 images')
    expect(wrapper.get('[data-testid="storage-category-uploads-summary"]')
      .text()).toBe('5.0 MB · 1 file')
    expect(wrapper.get('[data-testid="storage-category-artifacts-summary"]')
      .text()).toBe('2.0 MB · 3 artifacts')
    expect(wrapper.get('[data-testid="storage-category-knowledge-summary"]')
      .text()).toBe('2.0 MB · 9 items')
    expect(wrapper.get('[data-testid="storage-category-skills-summary"]')
      .text()).toBe('1.0 MB · 2 skills')
    expect(wrapper.get('[data-testid="storage-category-generatedFiles"]')
      .text()).toContain('Generated files')
  })

  it('hides the Google Drive row until a copy exists', async () => {
    const empty = await mountPage({
      data: createStats({
        breakdown: {
          totalBytes: 3 * MEGABYTE,
          categories: [
            { id: 'uploads', bytes: 3 * MEGABYTE, count: 1 },
            { id: 'googleDrive', bytes: 0, count: 0 },
          ],
        },
      }),
    })

    expect(empty.find('[data-testid="storage-category-googleDrive"]').exists())
      .toBe(false)

    const withCopy = await mountPage({
      data: createStats({
        breakdown: {
          totalBytes: 3 * MEGABYTE,
          categories: [
            { id: 'uploads', bytes: MEGABYTE, count: 1 },
            { id: 'googleDrive', bytes: 2 * MEGABYTE, count: 2 },
          ],
        },
      }),
    })

    expect(withCopy.get('[data-testid="storage-category-googleDrive-summary"]')
      .text()).toBe('2.0 MB · 2 copies')
    expect(withCopy.get('[data-testid="storage-category-googleDrive"]')
      .text()).toContain('Google Drive copies')
  })

  it.each([
    ['aiImages', 'i-lucide:images'],
    ['uploads', 'i-lucide:paperclip'],
    ['generatedFiles', 'i-lucide:file-text'],
    ['artifacts', 'i-lucide:app-window'],
    ['knowledge', 'i-lucide:book-open'],
    ['skills', 'i-lucide:sparkles'],
  ])('gives %s the %s icon', async (id, icon) => {
    const wrapper = await mountPage()

    expect(wrapper.get(`[data-testid="storage-category-${id}"] .iconify`)
      .classes()).toContain(icon)
  })

  it('links artifacts, project knowledge and skills to where space is freed', async () => {
    const wrapper = await mountPage()

    expect(wrapper.get('[data-testid="storage-manage-artifacts"]')
      .attributes('to')).toBe('/chats/artifacts')
    expect(wrapper.get('[data-testid="storage-manage-knowledge"]')
      .attributes('to')).toBe('/chats/projects')
    expect(wrapper.get('[data-testid="storage-manage-skills"]')
      .attributes('to')).toBe('/chats/skills')
  })

  it('opens the file manager on the matching source', async () => {
    const wrapper = await mountPage()

    await wrapper.get('[data-testid="storage-manage-aiImages"]')
      .trigger('click')

    expect(mocks.requestOpen).toHaveBeenCalledWith(
      'select',
      '/chats/new',
      'assistant',
    )
    expect(mocks.navigateTo).toHaveBeenCalledWith('/chats/new')

    await wrapper.get('[data-testid="storage-manage-uploads"]')
      .trigger('click')

    expect(mocks.requestOpen).toHaveBeenLastCalledWith(
      'select',
      '/chats/new',
      'upload',
    )
  })

  it('offers no link for a category with nothing in it', async () => {
    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="storage-manage-generatedFiles"]')
      .exists()).toBe(false)
  })

  it('hides the Artifacts link while the artifacts feature is off', async () => {
    mocks.artifactsActive.value = false

    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="storage-manage-artifacts"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="storage-manage-knowledge"]').exists())
      .toBe(true)
  })

  it('hides the Skills link while the skills feature is off', async () => {
    mocks.skillsActive.value = false

    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="storage-manage-skills"]').exists())
      .toBe(false)
    expect(wrapper.get('[data-testid="storage-category-skills-summary"]')
      .text()).toBe('1.0 MB · 2 skills')
    expect(wrapper.find('[data-testid="storage-manage-artifacts"]').exists())
      .toBe(true)
  })

  it('turns the bar red and says storage is full at the limit', async () => {
    const wrapper = await mountPage({
      data: createStats({ used: 20 * MEGABYTE, percentage: 100 }),
    })
    const progress = wrapper.get('[data-testid="storage-progress"]')

    expect(progress.classes()).toContain('progress-error')
    expect(wrapper.get('[data-testid="storage-full-notice"]').text())
      .toContain('Storage is full')
  })

  it('clamps the bar when an account is over its allowance', async () => {
    const wrapper = await mountPage({
      data: createStats({ used: 30 * MEGABYTE, percentage: 150 }),
    })

    expect(wrapper.get('[data-testid="storage-progress"]').attributes('value'))
      .toBe('100')
    expect(wrapper.get('[data-testid="storage-usage-text"]').text())
      .toBe('30.0 MB of 20.0 MB used')
  })

  it('warns in amber from 80 percent', async () => {
    const wrapper = await mountPage({
      data: createStats({ used: 17 * MEGABYTE, percentage: 85 }),
    })

    expect(wrapper.get('[data-testid="storage-progress"]').classes())
      .toContain('progress-warning')
    expect(wrapper.find('[data-testid="storage-full-notice"]').exists())
      .toBe(false)
  })

  it('shows the empty state when nothing is stored', async () => {
    const wrapper = await mountPage({
      data: createStats({
        used: 0,
        percentage: 0,
        breakdown: {
          totalBytes: 0,
          categories: [
            { id: 'aiImages', bytes: 0, count: 0 },
            { id: 'uploads', bytes: 0, count: 0 },
            { id: 'generatedFiles', bytes: 0, count: 0 },
            { id: 'artifacts', bytes: 0, count: 0 },
            { id: 'knowledge', bytes: 0, count: 0 },
            { id: 'skills', bytes: 0, count: 0 },
          ],
        },
      }),
    })

    expect(wrapper.find('[data-testid="storage-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="storage-categories"]').exists())
      .toBe(false)
    expect(wrapper.get('[data-testid="storage-usage-text"]').text())
      .toBe('0 B of 20.0 MB used')
  })

  it('shows an error with Retry that refetches', async () => {
    const wrapper = await mountPage({
      data: null,
      status: 'error',
      error: new Error('boom'),
    })

    expect(wrapper.find('[data-testid="storage-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="storage-categories"]').exists())
      .toBe(false)

    await wrapper.get('[data-testid="storage-retry"]').trigger('click')

    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  describe('skeleton', () => {
    it('stays hidden for a fast response and appears after 300 ms', async () => {
      vi.useFakeTimers()

      const wrapper = await mountPage({ data: null, status: 'pending' })

      expect(wrapper.find('[data-testid="storage-skeleton"]').exists())
        .toBe(false)

      await vi.advanceTimersByTimeAsync(299)
      await nextTick()

      expect(wrapper.find('[data-testid="storage-skeleton"]').exists())
        .toBe(false)

      await vi.advanceTimersByTimeAsync(2)
      await nextTick()

      expect(wrapper.find('[data-testid="storage-skeleton"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="storage-usage-text"]').exists())
        .toBe(false)
    })
  })
})
