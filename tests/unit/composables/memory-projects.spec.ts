import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMemoryProjects } from '../../../app/composables/memory-projects'

const mocks = vi.hoisted(() => ({
  useLazyFetch: vi.fn(),
}))

mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)

describe('useMemoryProjects', () => {
  beforeEach(() => {
    mocks.useLazyFetch.mockReset()
    mocks.useLazyFetch.mockReturnValue({
      data: shallowRef({
        pinned: [{
          id: 'project-pinned',
          name: 'Pinned project',
          memoryStatus: 'ready',
          extra: 1,
        }],
        projects: [{
          id: 'project-1',
          name: 'Home lab',
          memoryStatus: 'disabled',
          extra: 2,
        }],
        nextCursor: null,
      }),
      pending: shallowRef(false),
    })
  })

  it('requests up to 100 projects under a shared key', () => {
    useMemoryProjects()

    expect(mocks.useLazyFetch).toHaveBeenCalledWith(
      '/api/v1/projects',
      { key: 'memory-scope-projects', query: { limit: 100 } },
      expect.any(String),
    )
  })

  it('lists pinned projects first with only id, name and memory status', () => {
    const { projects } = useMemoryProjects()

    expect(projects.value).toEqual([
      { id: 'project-pinned', name: 'Pinned project', memoryStatus: 'ready' },
      { id: 'project-1', name: 'Home lab', memoryStatus: 'disabled' },
    ])
  })

  it('is empty until the projects load', () => {
    mocks.useLazyFetch.mockReturnValue({
      data: shallowRef(null),
      pending: shallowRef(true),
    })

    const { projects, isLoading } = useMemoryProjects()

    expect(projects.value).toEqual([])
    expect(isLoading.value).toBe(true)
  })

  it('is not loading once the projects arrived', () => {
    const { isLoading } = useMemoryProjects()

    expect(isLoading.value).toBe(false)
  })

  it('is not loading when the request failed', () => {
    mocks.useLazyFetch.mockReturnValue({
      data: shallowRef(null),
      pending: shallowRef(false),
    })

    const { isLoading } = useMemoryProjects()

    expect(isLoading.value).toBe(false)
  })
})
