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
        pinned: [{ id: 'project-pinned', name: 'Pinned project', extra: 1 }],
        projects: [{ id: 'project-1', name: 'Home lab', extra: 2 }],
        nextCursor: null,
      }),
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

  it('lists pinned projects first with only id and name', () => {
    const { projects } = useMemoryProjects()

    expect(projects.value).toEqual([
      { id: 'project-pinned', name: 'Pinned project' },
      { id: 'project-1', name: 'Home lab' },
    ])
  })

  it('is empty until the projects load', () => {
    mocks.useLazyFetch.mockReturnValue({ data: shallowRef(null) })

    const { projects } = useMemoryProjects()

    expect(projects.value).toEqual([])
  })

  it('resolves a project name by id', () => {
    const { getProjectName } = useMemoryProjects()

    expect(getProjectName('project-1')).toBe('Home lab')
    expect(getProjectName('unknown')).toBeNull()
    expect(getProjectName(null)).toBeNull()
  })
})
