import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ListView from '../../../../../../../../app/components/ChatInput/Files/Modal/Select/List/View.vue'

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
})
