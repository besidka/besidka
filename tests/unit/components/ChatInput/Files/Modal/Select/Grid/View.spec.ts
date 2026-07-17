import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import GridView from '../../../../../../../../app/components/ChatInput/Files/Modal/Select/Grid/View.vue'

const file = {
  id: 'file-1',
  storageKey: 'file-1.png',
  name: 'Generated image.png',
  size: 2048,
  type: 'image/png',
  source: 'assistant' as const,
  createdAt: '2026-07-15T12:00:00.000Z',
}

describe('ChatInput/Files/Modal/Select/Grid/View', () => {
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
})
