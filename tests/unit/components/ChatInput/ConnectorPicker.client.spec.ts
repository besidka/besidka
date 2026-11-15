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
  },
  {
    id: 'c2',
    slug: 'linear',
    title: 'Linear',
    host: 'mcp.linear.app',
    status: 'drifted',
  },
  {
    id: 'c3',
    slug: 'sentry',
    title: 'Sentry',
    host: 'mcp.sentry.dev',
    status: 'ready',
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
    isAtLimit: boolean
    isSaving: boolean
    besidka: { enabled: boolean, isSaving: boolean } | null
    areConnectorsAvailable: boolean
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
    expect(list.querySelectorAll('img')).toHaveLength(0)
    expect(list.querySelectorAll('li')).toHaveLength(3)
  })

  it('shows a generated initial instead of a logo', async () => {
    await mountPicker()

    const initials = Array.from(
      get('connector-picker-list').querySelectorAll('li span[aria-hidden="true"]'),
    ).map(element => element.textContent?.trim())

    expect(initials).toEqual(['N', 'L', 'S'])
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
      .toContain('/profile/connectors')

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

  it('shows only the Besidka row when connectors are not available',
    async () => {
      await mountPicker({
        items: [],
        besidka: { enabled: true, isSaving: false },
        areConnectorsAvailable: false,
      })

      expect(find('connector-picker-besidka')).not.toBeNull()
      expect(find('connector-picker-empty')).toBeNull()
      expect(find('connector-picker-manage')).toBeNull()
    })

  it('closes from the close button', async () => {
    const wrapper = await mountPicker()

    get('connector-picker-close').click()
    await flushPromises()

    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })
})
