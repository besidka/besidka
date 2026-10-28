import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { ChatInputTile } from '../../../../../../app/types/chat-input-tools'
import Preview from '../../../../../../app/components/ChatInput/Files/Attached/Preview.client.vue'

function createTile(overrides: Partial<ChatInputTile>): ChatInputTile {
  return {
    id: 'search',
    section: 'search',
    icon: { kind: 'icon', name: 'lucide:globe' },
    caption: 'Web search',
    value: 'Built-in',
    chipLabel: 'Search: Built-in',
    ariaLabel: 'Web search: Built-in',
    removeLabel: 'Turn off web search',
    isNeutral: false,
    isAuto: false,
    isLocked: false,
    isDisabled: false,
    ...overrides,
  }
}

const files = [
  { storageKey: 'a', name: 'a.png', type: 'image/png', size: 1 },
  { storageKey: 'b', name: 'b.png', type: 'image/png', size: 1 },
]

describe('ChatInput/Files/Attached/Preview', () => {
  it('renders nothing without tiles or files', async () => {
    const wrapper = await mountSuspended(Preview, {
      props: { files: [], tiles: [] },
    })

    expect(wrapper.find('[role="region"]').exists()).toBe(false)
  })

  it('renders tiles alone when there are no files', async () => {
    const wrapper = await mountSuspended(Preview, {
      props: { files: [], tiles: [createTile({})] },
    })

    expect(wrapper.get('[role="region"]').attributes('aria-label'))
      .toBe('Active settings')
    expect(wrapper.find('[data-testid="chat-input-tile-search"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="carousel-item"]').exists()).toBe(false)
  })

  it('puts tiles before files and counts only files in Detach all',
    async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files,
          tiles: [
            createTile({ id: 'project', section: 'project' }),
            createTile({}),
          ],
        },
      })
      const items = wrapper.findAll('.carousel > *')

      expect(items[0]?.attributes('data-testid'))
        .toBe('chat-input-tile-project')
      expect(items[1]?.attributes('data-testid'))
        .toBe('chat-input-tile-search')
      expect(items[2]?.attributes('data-testid')).toBe('carousel-item')
      expect(wrapper.get('[data-testid="files-preview-detach-all"]').text())
        .toContain('2')
      expect(wrapper.get('[role="region"]').attributes('aria-label'))
        .toBe('Active settings and files')
    })

  it('re-emits tile open and remove events', async () => {
    const wrapper = await mountSuspended(Preview, {
      props: { files: [], tiles: [createTile({})] },
    })

    await wrapper.get('[data-testid="chat-input-tile-search-body"]')
      .trigger('click')
    await wrapper.get('[data-testid="chat-input-tile-search-remove"]')
      .trigger('click')

    expect(wrapper.emitted('open-tile')?.[0]?.[0]).toBe('search')
    expect(wrapper.emitted('remove-tile')).toEqual([['search']])
  })

  it('renders tiles as pills while there are no files', async () => {
    const wrapper = await mountSuspended(Preview, {
      props: { files: [], tiles: [createTile({})] },
    })

    expect(
      wrapper.get('[data-testid="chat-input-tile-search-body"]')
        .attributes('data-variant'),
    ).toBe('pill')
  })

  it('renders tiles as pills when only a completed upload is listed',
    async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [],
          tiles: [createTile({})],
          uploadingFiles: new Map([[
            'u1',
            {
              id: 'u1',
              file: new File(['x'], 'x.png', { type: 'image/png' }),
              progress: 100,
              status: 'completed',
            },
          ]]) as never,
        },
      })

      expect(
        wrapper.get('[data-testid="chat-input-tile-search-body"]')
          .attributes('data-variant'),
      ).toBe('pill')
    })

  it('switches every tile to the square size once a file is attached',
    async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [files[0]!],
          tiles: [
            createTile({ id: 'project', section: 'project' }),
            createTile({}),
          ],
        },
      })

      expect(
        wrapper.get('[data-testid="chat-input-tile-project-body"]')
          .attributes('data-variant'),
      ).toBe('square')
      expect(
        wrapper.get('[data-testid="chat-input-tile-search-body"]')
          .attributes('data-variant'),
      ).toBe('square')
    })

  it('switches back to pills when the last file is removed', async () => {
    const wrapper = await mountSuspended(Preview, {
      props: { files: [files[0]!], tiles: [createTile({})] },
    })

    await wrapper.setProps({ files: [] })

    expect(
      wrapper.get('[data-testid="chat-input-tile-search-body"]')
        .attributes('data-variant'),
    ).toBe('pill')
  })
})
