import { nextTick } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProjectGroups from '../../../../../../../app/components/ChatInput/Files/Modal/Select/ProjectGroups.vue'
import type {
  FileManagerFile,
  ProjectFileGroup,
} from '../../../../../../../app/types/file-manager'

function createFile(id: string, name = `${id}.pdf`): FileManagerFile {
  return {
    id,
    storageKey: `${id}.pdf`,
    name,
    size: 2048,
    type: 'application/pdf',
    source: 'upload',
    createdAt: '2026-07-15T12:00:00.000Z',
  }
}

function createGroup(
  overrides: Partial<ProjectFileGroup> = {},
): ProjectFileGroup {
  const files = overrides.files ?? []

  return {
    id: 'project-a',
    name: 'Alpha',
    fileCount: files.length,
    pinned: false,
    archived: false,
    files,
    total: files.length,
    serverOffset: files.length,
    isLoading: false,
    isOpen: true,
    hasLoaded: files.length > 0,
    hasError: false,
    ...overrides,
  }
}

async function mountGroups(
  groups: ProjectFileGroup[],
  props: Record<string, unknown> = {},
) {
  const wrapper = await mountSuspended(ProjectGroups, {
    props: {
      groups,
      selectedIds: new Set<string>(),
      viewMode: 'grid',
      isTouchSelecting: false,
      touchedIndices: new Set<number>(),
      touchGroupId: null,
      ...props,
    },
  })

  const expectedViewCount = groups.filter((group) => {
    return group.isOpen && group.hasLoaded
  }).length

  await vi.waitFor(() => {
    expect(
      wrapper.findAll('[data-testid="files-project-group"] .select-none'),
    ).toHaveLength(expectedViewCount)
  })

  return wrapper
}

describe('ChatInput/Files/Modal/Select/ProjectGroups', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders one section per project with name and count', async () => {
    const wrapper = await mountGroups([
      createGroup({
        files: [createFile('file-1'), createFile('file-2')],
        total: 5,
        fileCount: 5,
      }),
      createGroup({
        id: 'project-b',
        name: 'Beta',
        fileCount: 3,
        total: 3,
        isOpen: false,
        hasLoaded: false,
        serverOffset: 0,
      }),
    ])

    const sections = wrapper.findAll('[data-testid="files-project-group"]')
    const counts = wrapper.findAll(
      '[data-testid="files-project-group-count"]',
    )

    expect(sections).toHaveLength(2)
    expect(sections[0]?.text()).toContain('Alpha')
    expect(sections[1]?.text()).toContain('Beta')
    expect(counts[0]?.text()).toBe('2/5')
    expect(counts[1]?.text()).toBe('3')
  })

  it('shows pinned and archived markers', async () => {
    const wrapper = await mountGroups([
      createGroup({ pinned: true, isOpen: false }),
      createGroup({
        id: 'project-b',
        name: 'Beta',
        archived: true,
        isOpen: false,
      }),
    ])

    const sections = wrapper.findAll('[data-testid="files-project-group"]')

    expect(sections[0]?.find('[aria-label="Pinned"]').exists()).toBe(true)
    expect(sections[0]?.text()).not.toContain('Archived')
    expect(sections[1]?.text()).toContain('Archived')
  })

  it('renders file tiles only for open groups', async () => {
    const wrapper = await mountGroups([
      createGroup({ files: [createFile('file-1')] }),
      createGroup({
        id: 'project-b',
        name: 'Beta',
        files: [createFile('file-2')],
        isOpen: false,
      }),
    ])

    const sections = wrapper.findAll('[data-testid="files-project-group"]')

    expect(sections[0]?.attributes('open')).toBeDefined()
    expect(sections[0]?.findAll('[data-file-index]')).toHaveLength(1)
    expect(sections[1]?.attributes('open')).toBeUndefined()
    expect(sections[1]?.findAll('[data-file-index]')).toHaveLength(0)
  })

  it('emits toggle from the section header without native toggling', async () => {
    const wrapper = await mountGroups([
      createGroup({ isOpen: false }),
    ])

    await wrapper.get('[data-testid="files-project-group-toggle"]')
      .trigger('click')

    expect(wrapper.emitted('toggle')?.[0]).toEqual(['project-a'])
    expect(
      wrapper.get('[data-testid="files-project-group"]').attributes('open'),
    ).toBeUndefined()
  })

  it('pins the section header to the top of the scroll area', async () => {
    const wrapper = await mountGroups([
      createGroup({ files: [createFile('file-1')] }),
      createGroup({ id: 'project-b', name: 'Beta', isOpen: false }),
    ])

    for (const toggle of wrapper.findAll(
      '[data-testid="files-project-group-toggle"]',
    )) {
      const classes = toggle.classes()

      expect(classes).toContain('sticky')
      expect(classes).toContain('top-0')
      expect(classes).toContain('z-20')
      expect(classes).toContain('h-11')
      expect(classes).toContain('bg-base-100')
    }
  })

  it('offsets the table header below the section header in list mode', async () => {
    const wrapper = await mountGroups([
      createGroup({ files: [createFile('file-1')] }),
    ], { viewMode: 'list' })

    const thead = wrapper.get('[data-testid="files-list-table"] thead')

    expect(thead.classes()).toContain('top-11')
  })

  function mockStuckGeometry(
    wrapper: Awaited<ReturnType<typeof mountGroups>>,
    isStuck: boolean,
  ) {
    const details = wrapper.get('[data-testid="files-project-group"]')
    const summary = wrapper.get('[data-testid="files-project-group-toggle"]')
    const scrollIntoView = vi.fn()

    vi.spyOn(details.element, 'getBoundingClientRect').mockReturnValue({
      top: -200,
    } as DOMRect)
    vi.spyOn(summary.element, 'getBoundingClientRect').mockReturnValue({
      top: isStuck ? 0 : -200,
    } as DOMRect)
    details.element.scrollIntoView = scrollIntoView

    return { summary, scrollIntoView }
  }

  it('scrolls a collapsed section header to the top when it was stuck', async () => {
    const wrapper = await mountGroups([
      createGroup({ files: [createFile('file-1')] }),
    ])
    const { summary, scrollIntoView } = mockStuckGeometry(wrapper, true)

    await summary.trigger('click')
    await nextTick()

    expect(wrapper.emitted('toggle')?.[0]).toEqual(['project-a'])
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  })

  it('does not scroll when the section header is not stuck', async () => {
    const wrapper = await mountGroups([
      createGroup({ files: [createFile('file-1')] }),
    ])
    const { summary, scrollIntoView } = mockStuckGeometry(wrapper, false)

    await summary.trigger('click')
    await nextTick()

    expect(wrapper.emitted('toggle')?.[0]).toEqual(['project-a'])
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not scroll when expanding a section', async () => {
    const wrapper = await mountGroups([
      createGroup({ isOpen: false }),
    ])
    const { summary, scrollIntoView } = mockStuckGeometry(wrapper, true)

    await summary.trigger('click')
    await nextTick()

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('shows a skeleton while the first page loads', async () => {
    const wrapper = await mountGroups([
      createGroup({ isLoading: true, hasLoaded: false, fileCount: 4 }),
    ])

    await vi.waitFor(() => {
      expect(wrapper.find('.skeleton').exists()).toBe(true)
    })

    expect(wrapper.find('[data-file-index]').exists()).toBe(false)
  })

  it('shows a skeleton, not a retry, for an unloaded group that is idle', async () => {
    const wrapper = await mountGroups([
      createGroup({ isLoading: false, hasLoaded: false, fileCount: 4 }),
    ])

    await vi.waitFor(() => {
      expect(wrapper.find('.skeleton').exists()).toBe(true)
    })

    expect(
      wrapper.find('[data-testid="files-project-group-retry"]').exists(),
    ).toBe(false)
  })

  it('uses a named group so tile hover actions stay scoped to the tile', async () => {
    const wrapper = await mountGroups([
      createGroup({ files: [createFile('file-1')] }),
    ])
    const classes = wrapper.get('[data-testid="files-project-group"]').classes()

    expect(classes).not.toContain('group')
    expect(classes).toContain('group/project-group')
  })

  it('offers a retry when the first page failed', async () => {
    const wrapper = await mountGroups([
      createGroup({
        isLoading: false,
        hasLoaded: false,
        hasError: true,
        fileCount: 4,
      }),
    ])

    await wrapper.get('[data-testid="files-project-group-retry"]')
      .trigger('click')

    expect(wrapper.emitted('load-more')?.[0]).toEqual(['project-a'])
  })

  it('renders a per-group load more with a counter', async () => {
    const wrapper = await mountGroups([
      createGroup({
        files: [createFile('file-1'), createFile('file-2')],
        total: 5,
        serverOffset: 2,
      }),
      createGroup({
        id: 'project-b',
        name: 'Beta',
        files: [createFile('file-3')],
        total: 1,
      }),
    ])

    const buttons = wrapper.findAll(
      '[data-testid="files-project-group-load-more"]',
    )

    expect(buttons).toHaveLength(1)
    expect(wrapper.text()).toContain('2 / 5')

    await buttons[0]?.trigger('click')

    expect(wrapper.emitted('load-more')?.[0]).toEqual(['project-a'])
  })

  it('disables load more while that group loads', async () => {
    const wrapper = await mountGroups([
      createGroup({
        files: [createFile('file-1')],
        total: 5,
        isLoading: true,
      }),
    ])

    expect(
      wrapper.get('[data-testid="files-project-group-load-more"]')
        .attributes('disabled'),
    ).toBeDefined()
  })

  it('tags each tile with its group index and group id in grid mode', async () => {
    const wrapper = await mountGroups([
      createGroup({
        files: [createFile('file-1'), createFile('file-2')],
      }),
      createGroup({
        id: 'project-b',
        name: 'Beta',
        files: [createFile('file-3')],
      }),
    ])

    const groupElements = wrapper.findAll('[data-testid="files-project-group"]')

    expect(groupElements.map((element) => {
      return element.attributes('data-project-group-id')
    })).toEqual(['project-a', 'project-b'])
    expect(groupElements[0]?.findAll('[data-file-index]').map((tile) => {
      return tile.attributes('data-file-index')
    })).toEqual(['0', '1'])
    expect(groupElements[1]?.findAll('[data-file-index]').map((tile) => {
      return tile.attributes('data-file-index')
    })).toEqual(['0'])
  })

  it('emits file clicks with the group id', async () => {
    const wrapper = await mountGroups([
      createGroup({ files: [createFile('file-1')] }),
      createGroup({
        id: 'project-b',
        name: 'Beta',
        files: [createFile('file-2')],
      }),
    ])

    await wrapper.findAll('[data-testid="files-project-group"]')[1]
      ?.get('[data-file-index="0"]')
      .trigger('click')

    const [event, file, index, groupId] = wrapper.emitted('file-click')![0]!

    expect(event).toBeInstanceOf(MouseEvent)
    expect((file as FileManagerFile).id).toBe('file-2')
    expect(index).toBe(0)
    expect(groupId).toBe('project-b')
  })

  it('marks a shared file selected in every group that lists it', async () => {
    const wrapper = await mountGroups([
      createGroup({ files: [createFile('shared')] }),
      createGroup({
        id: 'project-b',
        name: 'Beta',
        files: [createFile('shared'), createFile('only-b')],
      }),
    ], {
      selectedIds: new Set(['shared']),
    })

    const groupElements = wrapper.findAll('[data-testid="files-project-group"]')
    const selectedPressed = groupElements.map((element) => {
      return element.findAll('[data-file-index]').map((tile) => {
        return tile.attributes('aria-pressed')
      })
    })

    expect(selectedPressed).toEqual([['true'], ['true', 'false']])
  })

  it('renders one table per group in list mode with its own select all', async () => {
    const wrapper = await mountGroups([
      createGroup({
        files: [createFile('file-1'), createFile('file-2')],
      }),
      createGroup({
        id: 'project-b',
        name: 'Beta',
        files: [createFile('file-3')],
      }),
    ], {
      viewMode: 'list',
      selectedIds: new Set(['file-1', 'file-2']),
    })

    await vi.waitFor(() => {
      expect(wrapper.findAll('table')).toHaveLength(2)
    })

    const groupElements = wrapper.findAll('[data-testid="files-project-group"]')
    const headerCheckboxes = groupElements.map((element) => {
      return element.get('thead input[type="checkbox"]')
        .element as HTMLInputElement
    })

    expect(headerCheckboxes[0]?.checked).toBe(true)
    expect(headerCheckboxes[1]?.checked).toBe(false)

    await groupElements[1]?.get('thead input[type="checkbox"]')
      .trigger('change')

    expect(wrapper.emitted('toggle-select-all')?.[0]).toEqual(['project-b'])
  })

  it('emits list row clicks with the group id', async () => {
    const wrapper = await mountGroups([
      createGroup({ files: [createFile('file-1')] }),
    ], { viewMode: 'list' })

    await vi.waitFor(() => {
      expect(wrapper.find('tbody tr').exists()).toBe(true)
    })

    await wrapper.get('tbody tr').trigger('click')

    expect(wrapper.emitted('file-click')?.[0]?.[3]).toBe('project-a')
  })

  it('highlights touch-selected indices only in the touched group', async () => {
    const wrapper = await mountGroups([
      createGroup({
        files: [createFile('file-1'), createFile('file-2')],
      }),
      createGroup({
        id: 'project-b',
        name: 'Beta',
        files: [createFile('file-3'), createFile('file-4')],
      }),
    ], {
      isTouchSelecting: true,
      touchedIndices: new Set([1]),
      touchGroupId: 'project-b',
    })

    const groupElements = wrapper.findAll('[data-testid="files-project-group"]')
    const touchedClass = 'ring-secondary-content/50'

    expect(
      groupElements[0]?.findAll('[data-file-index]').some((tile) => {
        return tile.classes().includes(touchedClass)
      }),
    ).toBe(false)
    expect(
      groupElements[1]?.get('[data-file-index="1"]').classes(),
    ).toContain(touchedClass)
    expect(
      groupElements[1]?.get('[data-file-index="0"]').classes(),
    ).not.toContain(touchedClass)
  })

  it('exposes the container for touch listeners', async () => {
    const wrapper = await mountGroups([createGroup()])

    expect(wrapper.vm.containerRef).toBe(
      wrapper.get('[data-testid="files-project-groups"]').element,
    )
  })
})
