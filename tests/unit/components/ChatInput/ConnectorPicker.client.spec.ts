import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConnectorPicker from '../../../../app/components/ChatInput/ConnectorPicker.client.vue'
import type { ComposerConnectorItem } from '../../../../app/composables/composer-connectors'

enableAutoUnmount(afterEach)

const items: ComposerConnectorItem[] = [
  {
    id: 'c1',
    slug: 'notion',
    title: 'Notion',
    host: 'mcp.notion.com',
    status: 'ready',
    toolMode: 'manual',
    presetId: 'notion',
    isIconAvailable: false,
  },
  {
    id: 'c2',
    slug: 'linear',
    title: 'Linear',
    host: 'mcp.linear.app',
    status: 'drifted',
    toolMode: 'manual',
    presetId: null,
    isIconAvailable: true,
  },
  {
    id: 'c3',
    slug: 'sentry',
    title: 'Sentry',
    host: 'mcp.sentry.dev',
    status: 'ready',
    toolMode: 'manual',
    presetId: null,
    isIconAvailable: false,
  },
]

function find(id: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${id}"]`)
}

function get(id: string): HTMLElement {
  const element = find(id)

  if (!element) {
    throw new Error(`Missing ${id}`)
  }

  return element
}

async function mountPicker(
  overrides: Partial<{
    items: ComposerConnectorItem[]
    selectedIds: string[]
    offIds: string[]
    isAtLimit: boolean
    isSaving: boolean
    besidka: { enabled: boolean, isSaving: boolean } | null
    isLoaded: boolean
    isRegistryAvailable: boolean
  }> = {},
) {
  const wrapper = await mountSuspended(ConnectorPicker, {
    props: {
      items,
      selectedIds: [],
      isAtLimit: false,
      isSaving: false,
      open: true,
      ...overrides,
    },
    attachTo: document.body,
    global: { stubs: { teleport: false } },
  })

  await flushPromises()

  return wrapper
}

describe('ChatInput/ConnectorPicker', () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens as a dialog and lists each connector with its title and host as text', async () => {
    await mountPicker()

    expect(get('connector-picker-dialog').hasAttribute('open')).toBe(true)

    const list = get('connector-picker-list')

    expect(list.textContent).toContain('Notion')
    expect(list.textContent).toContain('mcp.notion.com')
    expect(Array.from(list.querySelectorAll('img')).every((image) => {
      return image.getAttribute('src')?.startsWith('/api/v1/connectors/')
    })).toBe(true)
    expect(list.querySelectorAll('li')).toHaveLength(3)
  })

  it('shows a brand mark for a preset, the icon route for a connected '
    + 'connector and a letter otherwise, never a remote image', async () => {
    await mountPicker()

    const list = get('connector-picker-list')
    const images = Array.from(list.querySelectorAll('img'))

    expect(list.querySelectorAll('[data-testid="connector-avatar-brand"]'))
      .toHaveLength(1)
    expect(images.map(image => image.getAttribute('src')))
      .toEqual(['/api/v1/connectors/c2/icon'])
    expect(images[0]?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(list.textContent).toContain('S')
  })

  it('reflects the selection in each toggle', async () => {
    await mountPicker({ selectedIds: ['c2'] })

    expect((get('connector-picker-toggle-notion') as HTMLInputElement).checked)
      .toBe(false)
    expect((get('connector-picker-toggle-linear') as HTMLInputElement).checked)
      .toBe(true)
  })

  it('emits the connector id when a toggle is changed', async () => {
    const wrapper = await mountPicker()

    get('connector-picker-toggle-sentry').click()
    await flushPromises()

    expect(wrapper.emitted('toggle')).toEqual([['c3']])
  })

  it('marks a drifted connector with a soft badge only', async () => {
    await mountPicker()

    const badge = get('connector-picker-drifted-linear')

    expect(badge.className).toContain('badge')
    expect(badge.className).toContain('badge-soft')
    expect(badge.textContent).toContain('Tools changed')
    expect(find('connector-picker-drifted-notion')).toBeNull()
  })

  it('disables the other toggles at the limit but keeps the selected ones usable', async () => {
    await mountPicker({ selectedIds: ['c1'], isAtLimit: true })

    expect((get('connector-picker-toggle-notion') as HTMLInputElement).disabled)
      .toBe(false)
    expect((get('connector-picker-toggle-linear') as HTMLInputElement).disabled)
      .toBe(true)
    expect(get('connector-picker-limit-hint').textContent)
      .toContain('Turn one off')
  })

  it('shows the cap as plain information below the limit', async () => {
    await mountPicker()

    expect(get('connector-picker-limit-hint').textContent)
      .toContain('Up to 5 at once')
    expect((get('connector-picker-toggle-linear') as HTMLInputElement).disabled)
      .toBe(false)
  })

  it('disables every toggle while a change is being saved', async () => {
    await mountPicker({ selectedIds: ['c1'], isSaving: true })

    for (const slug of ['notion', 'linear', 'sentry']) {
      expect(
        (get(`connector-picker-toggle-${slug}`) as HTMLInputElement).disabled,
      ).toBe(true)
    }
  })

  it('shows an empty state without a list', async () => {
    await mountPicker({ items: [] })

    expect(get('connector-picker-empty').textContent)
      .toContain('No connectors yet')
    expect(find('connector-picker-list')).toBeNull()
    expect(find('connector-picker-manage')).not.toBeNull()
  })

  it('links to the connectors page and closes', async () => {
    const wrapper = await mountPicker()

    expect(get('connector-picker-manage').outerHTML)
      .toContain('/chats/connectors')

    get('connector-picker-manage').click()
    await flushPromises()

    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('shows no Besidka row unless one is passed', async () => {
    await mountPicker()

    expect(find('connector-picker-besidka')).toBeNull()
  })

  it('shows the Besidka row with its state and emits a toggle', async () => {
    const wrapper = await mountPicker({
      besidka: { enabled: true, isSaving: false },
    })
    const toggle = get('connector-picker-toggle-besidka') as HTMLInputElement

    expect(get('connector-picker-besidka').textContent).toContain('Besidka')
    expect(toggle.checked).toBe(true)
    expect(toggle.getAttribute('aria-label'))
      .toBe('Use Besidka tools in this chat')

    toggle.click()
    await flushPromises()

    expect(wrapper.emitted('toggle-besidka')).toHaveLength(1)
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })

  it('keeps the Besidka row out of the connector limit', async () => {
    await mountPicker({
      isAtLimit: true,
      selectedIds: ['c1'],
      besidka: { enabled: false, isSaving: false },
    })

    expect((get('connector-picker-toggle-besidka') as HTMLInputElement)
      .disabled).toBe(false)
  })

  it('shows the Besidka row above the empty state when there are no connectors', async () => {
    await mountPicker({
      items: [],
      besidka: { enabled: true, isSaving: false },
    })

    expect(find('connector-picker-besidka')).not.toBeNull()
    expect(find('connector-picker-empty')).not.toBeNull()
  })

  it('offers an Add a connector action in the empty state', async () => {
    const wrapper = await mountPicker({ items: [] })
    const add = get('connector-picker-add')

    expect(add.className).toContain('btn-primary')
    expect(add.outerHTML).toContain('/chats/connectors')
    expect(add.outerHTML).toContain('add=presets')

    add.click()
    await flushPromises()

    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('shows a skeleton instead of the empty state until the list is loaded', async () => {
    await mountPicker({ items: [], isLoaded: false })

    expect(find('connector-picker-skeleton')).not.toBeNull()
    expect(find('connector-picker-empty')).toBeNull()
  })

  it('shows Manage connectors at the top, with or without connectors', async () => {
    await mountPicker({ items: [] })

    const manage = get('connector-picker-manage')

    expect(manage.outerHTML).toContain('/chats/connectors')
    expect(manage.textContent).toContain('Manage connectors')
    expect(get('connector-picker-actions').contains(manage)).toBe(true)
  })

  it('shows Browse connectors only when the registry is available', async () => {
    await mountPicker()

    expect(find('connector-picker-browse')).toBeNull()

    document.body.innerHTML = ''

    await mountPicker({ isRegistryAvailable: true })

    const browse = get('connector-picker-browse')

    expect(browse.textContent).toContain('Browse connectors')
    expect(browse.outerHTML).toContain('add=directory')
  })

  it('keeps the limit hint with no connectors', async () => {
    await mountPicker({ items: [] })

    expect(get('connector-picker-limit-hint').textContent)
      .toContain('Up to 5 at once')
  })

  it('closes from the close button', async () => {
    const wrapper = await mountPicker()

    get('connector-picker-close').click()
    await flushPromises()

    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  describe('turn all on and off', () => {
    const sevenItems: ComposerConnectorItem[] = Array.from(
      { length: 7 },
      (_, index) => {
        return {
          id: `c${index}`,
          slug: `slug${index}`,
          title: `Connector ${index}`,
          host: `mcp${index}.example.com`,
          status: 'ready' as const,
          toolMode: 'manual' as const,
          presetId: null,
          isIconAvailable: false,
        }
      },
    )

    it('hides the bulk actions with fewer than two connectors', async () => {
      await mountPicker({ items: [items[0]!] })

      expect(find('connector-picker-bulk')).toBeNull()

      document.body.innerHTML = ''

      await mountPicker({ items: [] })

      expect(find('connector-picker-bulk')).toBeNull()
    })

    it('turns every connector on when they fit under the cap', async () => {
      const wrapper = await mountPicker()

      get('connector-picker-turn-all-on').click()
      await flushPromises()

      expect(wrapper.emitted('set-all')).toEqual([[['c1', 'c2', 'c3']]])
      expect(find('connector-picker-bulk-notice')).toBeNull()
    })

    it('turns on at most five in list order and says some stayed off',
      async () => {
        const wrapper = await mountPicker({ items: sevenItems })

        get('connector-picker-turn-all-on').click()
        await flushPromises()

        expect(wrapper.emitted('set-all')).toEqual([
          [['c0', 'c1', 'c2', 'c3', 'c4']],
        ])
        expect(get('connector-picker-bulk-notice').textContent)
          .toContain('5 of 7 are on. At most 5 can be on at once.')
      })

    it('keeps the connectors already on when turning all on', async () => {
      const wrapper = await mountPicker({
        items: sevenItems,
        selectedIds: ['c6'],
      })

      get('connector-picker-turn-all-on').click()
      await flushPromises()

      expect(wrapper.emitted('set-all')).toEqual([
        [['c6', 'c0', 'c1', 'c2', 'c3']],
      ])
    })

    it('turns everything off with an empty selection', async () => {
      const wrapper = await mountPicker({ selectedIds: ['c1', 'c3'] })

      get('connector-picker-turn-all-off').click()
      await flushPromises()

      expect(wrapper.emitted('set-all')).toEqual([[[]]])
    })

    it('clears the notice after turning all off or toggling one', async () => {
      const wrapper = await mountPicker({
        items: sevenItems,
        selectedIds: ['c1'],
      })

      get('connector-picker-turn-all-on').click()
      await flushPromises()

      expect(find('connector-picker-bulk-notice')).not.toBeNull()

      get('connector-picker-toggle-slug6').click()
      await flushPromises()

      expect(find('connector-picker-bulk-notice')).toBeNull()
      expect(wrapper.emitted('toggle')).toEqual([['c6']])
    })

    it('disables the actions that cannot do anything', async () => {
      await mountPicker()

      expect((get('connector-picker-turn-all-off') as HTMLButtonElement)
        .disabled).toBe(true)
      expect((get('connector-picker-turn-all-on') as HTMLButtonElement)
        .disabled).toBe(false)

      document.body.innerHTML = ''

      await mountPicker({ selectedIds: ['c1', 'c2', 'c3'] })

      expect((get('connector-picker-turn-all-on') as HTMLButtonElement)
        .disabled).toBe(true)
      expect((get('connector-picker-turn-all-off') as HTMLButtonElement)
        .disabled).toBe(false)

      document.body.innerHTML = ''

      await mountPicker({
        items: sevenItems,
        selectedIds: ['c0', 'c1', 'c2', 'c3', 'c4'],
        isAtLimit: true,
      })

      expect((get('connector-picker-turn-all-on') as HTMLButtonElement)
        .disabled).toBe(true)
    })

    it('disables both actions while a change is being saved', async () => {
      await mountPicker({ selectedIds: ['c1'], isSaving: true })

      expect((get('connector-picker-turn-all-on') as HTMLButtonElement)
        .disabled).toBe(true)
      expect((get('connector-picker-turn-all-off') as HTMLButtonElement)
        .disabled).toBe(true)
    })
  })

  describe('modes', () => {
    const modeItems: ComposerConnectorItem[] = [
      {
        id: 'a1',
        slug: 'alpha',
        title: 'Alpha',
        host: 'mcp.alpha.com',
        status: 'ready',
        toolMode: 'auto',
        presetId: null,
        isIconAvailable: false,
      },
      {
        id: 'o1',
        slug: 'omega',
        title: 'Omega',
        host: 'mcp.omega.com',
        status: 'ready',
        toolMode: 'always-on',
        presetId: null,
        isIconAvailable: false,
      },
      {
        id: 'm1',
        slug: 'manual',
        title: 'Manual',
        host: 'mcp.manual.com',
        status: 'ready',
        toolMode: 'manual',
        presetId: null,
        isIconAvailable: false,
      },
    ]

    function modeText(slug: string): string {
      return get(`connector-picker-mode-${slug}`).textContent
        ?.replace(/\s+/g, ' ').trim() ?? ''
    }

    it('shows each connector\'s mode next to its host', async () => {
      await mountPicker({ items: modeItems })

      expect(modeText('alpha')).toBe('mcp.alpha.com · Auto')
      expect(modeText('omega')).toBe('mcp.omega.com · Always on')
      expect(modeText('manual')).toBe('mcp.manual.com · Manual')
    })

    it('checks Auto and Always on connectors by default and a Manual one only when selected', async () => {
      await mountPicker({ items: modeItems })

      const isChecked = (slug: string) => {
        return (get(`connector-picker-toggle-${slug}`) as HTMLInputElement)
          .checked
      }

      expect(isChecked('alpha')).toBe(true)
      expect(isChecked('omega')).toBe(true)
      expect(isChecked('manual')).toBe(false)

      document.body.innerHTML = ''

      await mountPicker({ items: modeItems, selectedIds: ['m1'] })

      expect(isChecked('manual')).toBe(true)
    })

    it('unchecks an Auto connector that is off in this chat and says so', async () => {
      await mountPicker({ items: modeItems, offIds: ['a1'] })

      expect((get('connector-picker-toggle-alpha') as HTMLInputElement).checked)
        .toBe(false)
      expect(modeText('alpha')).toBe('mcp.alpha.com · Off in this chat')
      expect(modeText('omega')).toBe('mcp.omega.com · Always on')
    })

    it('emits a toggle for an Auto connector to switch it off', async () => {
      const wrapper = await mountPicker({ items: modeItems })

      get('connector-picker-toggle-alpha').click()
      await flushPromises()

      expect(wrapper.emitted('toggle')).toEqual([['a1']])
    })

    it('keeps Auto and Always on toggles usable at the limit', async () => {
      await mountPicker({
        items: modeItems,
        selectedIds: [],
        offIds: ['a1'],
        isAtLimit: true,
      })

      expect((get('connector-picker-toggle-alpha') as HTMLInputElement)
        .disabled).toBe(false)
      expect((get('connector-picker-toggle-omega') as HTMLInputElement)
        .disabled).toBe(false)
      expect((get('connector-picker-toggle-manual') as HTMLInputElement)
        .disabled).toBe(true)
    })

    it('shows the Auto hint only when an Auto connector exists', async () => {
      await mountPicker({ items: modeItems })

      expect(get('connector-picker-auto-hint').textContent)
        .toContain('Auto connectors are available in every chat')

      document.body.innerHTML = ''

      await mountPicker()

      expect(find('connector-picker-auto-hint')).toBeNull()
    })

    it('turns all on and off for Manual connectors only', async () => {
      const wrapper = await mountPicker({
        items: [
          ...modeItems,
          { ...modeItems[2]!, id: 'm2', slug: 'manual-two', title: 'Two' },
        ],
      })

      get('connector-picker-turn-all-on').click()
      await flushPromises()

      expect(wrapper.emitted('set-all')).toEqual([[['m1', 'm2']]])
    })

    it('leaves less room for Manual connectors when Always on ones count', async () => {
      const manualItems = Array.from({ length: 6 }, (_, index) => {
        return {
          ...modeItems[2]!,
          id: `m${index}`,
          slug: `manual-${index}`,
          title: `Manual ${index}`,
        }
      })
      const wrapper = await mountPicker({
        items: [modeItems[1]!, ...manualItems],
      })

      get('connector-picker-turn-all-on').click()
      await flushPromises()

      expect(wrapper.emitted('set-all')).toEqual([
        [['m0', 'm1', 'm2', 'm3']],
      ])
      expect(get('connector-picker-bulk-notice').textContent)
        .toContain('4 of 6 are on. At most 4 can be on at once.')
    })
  })
})
