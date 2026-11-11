import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import GridView from '../../../../../../../../app/components/ChatInput/Files/Modal/Select/Grid/View.vue'
import GridSkeleton from '../../../../../../../../app/components/ChatInput/Files/Modal/Select/Grid/Skeleton.vue'

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

  it('dims a tile the model cannot accept and explains why', async () => {
    const reason = 'This model does not support image input.'
    const wrapper = await mountSuspended(GridView, {
      props: {
        files: [file],
        selectedIds: new Set<string>(),
        isTouchSelecting: false,
        touchedIndices: new Set<number>(),
        unsupportedReasons: { 'file-1': reason },
      },
    })
    const tile = wrapper.get('[data-file-index="0"]')

    expect(tile.attributes('aria-disabled')).toBe('true')
    expect(tile.attributes('title')).toBe(reason)
    expect(tile.classes()).toEqual(
      expect.arrayContaining(['opacity-40', 'cursor-not-allowed']),
    )
  })

  it('leaves a supported tile enabled', async () => {
    const wrapper = await mountSuspended(GridView, {
      props: {
        files: [file],
        selectedIds: new Set<string>(),
        isTouchSelecting: false,
        touchedIndices: new Set<number>(),
      },
    })
    const tile = wrapper.get('[data-file-index="0"]')

    expect(tile.attributes('aria-disabled')).toBeUndefined()
    expect(tile.classes()).not.toContain('opacity-40')
  })

  it('shows six columns from lg in the wider modal', async () => {
    const wrapper = await mountSuspended(GridView, {
      props: {
        files: [file],
        selectedIds: new Set<string>(),
        isTouchSelecting: false,
        touchedIndices: new Set<number>(),
      },
    })

    expect(wrapper.classes()).toEqual(expect.arrayContaining([
      'grid',
      'grid-cols-3',
      'sm:grid-cols-4',
      'lg:grid-cols-6',
    ]))
  })

  it('keeps the skeleton on the same columns with full rows at every width', async () => {
    const wrapper = await mountSuspended(GridSkeleton)
    const tiles = wrapper.findAll('.skeleton')

    expect(wrapper.classes()).toEqual(expect.arrayContaining([
      'grid-cols-3',
      'sm:grid-cols-4',
      'lg:grid-cols-6',
    ]))
    expect(tiles).toHaveLength(12)
    expect(tiles.filter((tile) => {
      return tile.classes().includes('max-sm:hidden')
    })).toHaveLength(3)
    expect(tiles.every(tile => tile.classes().includes('skeleton--default')))
      .toBe(true)
  })
})
