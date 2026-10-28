import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { ChatInputTile } from '../../../../app/types/chat-input-tools'
import SettingTile from '../../../../app/components/ChatInput/SettingTile.vue'

function createTile(overrides: Partial<ChatInputTile> = {}): ChatInputTile {
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

describe('ChatInput/SettingTile', () => {
  it('renders the caption and value at the file tile size by default', async () => {
    const wrapper = await mountSuspended(SettingTile, {
      props: { tile: createTile() },
    })
    const body = wrapper.get('[data-testid="chat-input-tile-search-body"]')

    expect(body.classes()).toEqual(
      expect.arrayContaining(['size-16', 'rounded-box', 'bg-accent/10']),
    )
    expect(body.attributes('aria-label')).toBe('Web search: Built-in')
    expect(body.text()).toContain('Web search')
    expect(body.text()).toContain('Built-in')
  })

  it('keeps the square remove button at right-1 top-1', async () => {
    const wrapper = await mountSuspended(SettingTile, {
      props: { tile: createTile() },
    })
    const remove = wrapper.get('[data-testid="chat-input-tile-search-remove"]')

    expect(remove.classes()).toEqual(expect.arrayContaining([
      'absolute',
      'top-1',
      'right-1',
      'btn-circle',
      'btn-error',
      'btn-soft',
      'size-4',
    ]))
    expect(remove.classes()).not.toContain('right-2')
    expect(remove.classes()).not.toContain('top-3')
    expect(remove.attributes('aria-label')).toBe('Turn off web search')

    await remove.trigger('click')

    expect(wrapper.emitted('remove')).toEqual([['search']])
  })

  it('has no remove button when the tile cannot be removed', async () => {
    const wrapper = await mountSuspended(SettingTile, {
      props: { tile: createTile({ id: 'reasoning', removeLabel: null }) },
    })

    expect(
      wrapper.find('[data-testid="chat-input-tile-reasoning-remove"]')
        .exists(),
    ).toBe(false)
  })

  it('emits its section and origin when opened', async () => {
    const wrapper = await mountSuspended(SettingTile, {
      props: { tile: createTile() },
    })
    const body = wrapper.get('[data-testid="chat-input-tile-search-body"]')

    await body.trigger('click')

    expect(wrapper.emitted('open')?.[0]).toEqual(['search', body.element])
  })

  it('uses a neutral tone for Memory off', async () => {
    const wrapper = await mountSuspended(SettingTile, {
      props: {
        tile: createTile({
          id: 'memory',
          isNeutral: true,
          icon: { kind: 'icon', name: 'lucide:book-x' },
        }),
      },
    })

    expect(
      wrapper.get('[data-testid="chat-input-tile-memory-body"]').classes(),
    ).toContain('bg-base-content/7')
  })

  it('shows the provider icon with an Auto badge', async () => {
    const wrapper = await mountSuspended(SettingTile, {
      props: {
        tile: createTile({
          icon: { kind: 'provider', providerId: 'exa' },
          isAuto: true,
          caption: 'Auto search',
        }),
      },
    })

    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chat-input-tile-auto-badge"]')
      .exists()).toBe(true)
  })

  it('dims a disabled tile', async () => {
    const wrapper = await mountSuspended(SettingTile, {
      props: {
        tile: createTile({
          id: 'deep-research',
          removeLabel: null,
          isDisabled: true,
        }),
      },
    })
    const body = wrapper.get('[data-testid="chat-input-tile-deep-research-body"]')

    expect(body.classes()).toContain('opacity-60')
    expect(body.attributes('aria-disabled')).toBe('true')
  })

  it('renders a compact pill with the remove button clear of the text',
    async () => {
      const wrapper = await mountSuspended(SettingTile, {
        props: { tile: createTile(), variant: 'pill' },
      })
      const body = wrapper.get('[data-testid="chat-input-tile-search-body"]')
      const remove = wrapper.get(
        '[data-testid="chat-input-tile-search-remove"]',
      )

      expect(body.attributes('data-variant')).toBe('pill')
      expect(body.classes()).toEqual(expect.arrayContaining([
        'h-10',
        'max-w-40',
        'pr-7',
        'rounded-box',
        'bg-accent/10',
      ]))
      expect(body.classes()).not.toContain('size-16')
      expect(body.text()).toContain('Web search')
      expect(body.text()).toContain('Built-in')
      expect(remove.classes()).toEqual(
        expect.arrayContaining(['right-2', 'top-3', 'size-4']),
      )
      expect(remove.classes()).not.toContain('right-1')
      expect(remove.classes()).not.toContain('top-1')
    })

  it('does not reserve remove space on a pill that cannot be removed',
    async () => {
      const wrapper = await mountSuspended(SettingTile, {
        props: {
          tile: createTile({ id: 'reasoning', removeLabel: null }),
          variant: 'pill',
        },
      })
      const body = wrapper.get(
        '[data-testid="chat-input-tile-reasoning-body"]',
      )

      expect(body.classes()).toContain('px-2')
      expect(body.classes()).not.toContain('pr-7')
    })

  it('shows a lock badge instead of the Auto badge on a locked tile',
    async () => {
      const wrapper = await mountSuspended(SettingTile, {
        props: {
          tile: createTile({
            id: 'image',
            icon: { kind: 'icon', name: 'lucide:image-plus' },
            caption: 'Mode',
            value: 'Image generation',
            ariaLabel: 'Image generation is always on for this model',
            removeLabel: null,
            isLocked: true,
          }),
        },
      })
      const body = wrapper.get('[data-testid="chat-input-tile-image-body"]')

      expect(wrapper.find('[data-testid="chat-input-tile-lock-badge"]')
        .exists()).toBe(true)
      expect(wrapper.find('[data-testid="chat-input-tile-auto-badge"]')
        .exists()).toBe(false)
      expect(body.attributes('title'))
        .toBe('Image generation is always on for this model')
      expect(body.text()).not.toMatch(/required/i)
    })

  it('shows no lock badge on an unlocked tile', async () => {
    const wrapper = await mountSuspended(SettingTile, {
      props: { tile: createTile() },
    })

    expect(wrapper.find('[data-testid="chat-input-tile-lock-badge"]')
      .exists()).toBe(false)
  })
})
