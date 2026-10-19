import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import MermaidActionMenu from '../../../../app/components/prose/MermaidActionMenu.vue'
import {
  MERMAID_COPY_ACTIONS,
  MERMAID_DOWNLOAD_ACTIONS,
} from '../../../../app/utils/mermaid-menu-actions'
import type { DiagramExportAction } from '../../../../app/types/diagram-export.d'

const mocks = vi.hoisted(() => {
  return {
    runExportAction: vi.fn(),
    useErrorMessage: vi.fn(),
  }
})

mockNuxtImport('useDiagramExport', () => {
  return () => {
    return { runExportAction: mocks.runExportAction }
  }
})

mockNuxtImport('useErrorMessage', () => mocks.useErrorMessage)

const SOURCE = 'flowchart LR\n  A --> B'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'

const DOWNLOAD_ACTION_IDS: DiagramExportAction[] = [
  'download-svg',
  'download-png',
  'download-drawio',
]

const COPY_ACTION_IDS: DiagramExportAction[] = [
  'copy-source',
  'copy-markdown',
  'copy-svg',
  'copy-drawio',
]

const mountedWrappers: VueWrapper[] = []

async function mountMenu(
  kind: 'copy' | 'download',
  options: {
    svg?: string
    themeElement?: () => HTMLElement | null
    attachToBody?: boolean
  } = {},
) {
  const themeElement = document.createElement('div')

  const wrapper = await mountSuspended(MermaidActionMenu, {
    props: {
      label: kind === 'copy' ? 'Copy' : 'Download',
      icon: kind === 'copy' ? 'lucide:copy' : 'lucide:download',
      testId: kind === 'copy' ? 'mermaid-copy' : 'mermaid-download',
      actions: kind === 'copy'
        ? MERMAID_COPY_ACTIONS
        : MERMAID_DOWNLOAD_ACTIONS,
      input: {
        source: SOURCE,
        svg: options.svg ?? SVG,
        themeElement: options.themeElement ?? (() => themeElement),
      },
    },
    attachTo: options.attachToBody ? document.body : undefined,
  })

  mountedWrappers.push(wrapper)

  return { wrapper, themeElement }
}

describe('prose/MermaidActionMenu.vue', () => {
  beforeEach(() => {
    mocks.runExportAction.mockReset()
    mocks.runExportAction.mockResolvedValue(true)
    mocks.useErrorMessage.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()

    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount()
    }
  })

  it('renders the download items without a group heading', async () => {
    const { wrapper } = await mountMenu('download')

    expect(wrapper.get('[data-testid="mermaid-download"]').text())
      .toContain('Download')
    expect(wrapper.findAll('.menu-title')).toHaveLength(0)
    expect(wrapper.findAll('li button').map((button) => {
      return button.attributes('data-testid')
    })).toEqual(DOWNLOAD_ACTION_IDS.map((action) => {
      return `mermaid-export-${action}`
    }))
    expect(wrapper.findAll('li button').map((button) => {
      return button.text()
    })).toEqual(['SVG', 'PNG', '.drawio'])
  })

  it('renders the copy items without a group heading', async () => {
    const { wrapper } = await mountMenu('copy')

    expect(wrapper.get('[data-testid="mermaid-copy"]').text())
      .toContain('Copy')
    expect(wrapper.findAll('.menu-title')).toHaveLength(0)
    expect(wrapper.findAll('li button').map((button) => {
      return button.attributes('data-testid')
    })).toEqual(COPY_ACTION_IDS.map((action) => {
      return `mermaid-export-${action}`
    }))
    expect(wrapper.findAll('li button').map((button) => {
      return button.text()
    })).toEqual(['Code', 'Markdown', 'SVG', 'For draw.io'])
  })

  it('uses icon-only triggers below the sm breakpoint', async () => {
    const { wrapper } = await mountMenu('copy')

    expect(wrapper.get('[data-testid="mermaid-copy"]').html())
      .toContain('max-sm:sr-only')
  })

  it.each([
    ...DOWNLOAD_ACTION_IDS.map(action => ['download', action] as const),
    ...COPY_ACTION_IDS.map(action => ['copy', action] as const),
  ])('runs the %s menu action %s synchronously inside the click handler',
    async (kind, action) => {
      const { wrapper, themeElement } = await mountMenu(kind)
      const item = wrapper.get(`[data-testid="mermaid-export-${action}"]`)

      ;(item.element as HTMLButtonElement).click()

      expect(mocks.runExportAction).toHaveBeenCalledTimes(1)
      expect(mocks.runExportAction).toHaveBeenCalledWith(action, {
        source: SOURCE,
        svg: SVG,
        themeElement,
      })

      await flushPromises()
    })

  it.each(COPY_ACTION_IDS)('flips the trigger to a check after %s',
    async (action) => {
      vi.useFakeTimers()

      const { wrapper } = await mountMenu('copy')
      const trigger = wrapper.get('[data-testid="mermaid-copy"]')

      expect(trigger.text()).toContain('Copy')

      await wrapper.get(`[data-testid="mermaid-export-${action}"]`)
        .trigger('click')
      await flushPromises()

      expect(trigger.text()).toContain('Copied!')
      expect(trigger.html()).toContain('lucide:check')

      vi.advanceTimersByTime(2000)
      await flushPromises()

      expect(trigger.text()).not.toContain('Copied!')
      expect(trigger.text()).toContain('Copy')
    })

  it('restarts the feedback window on a repeated copy', async () => {
    vi.useFakeTimers()

    const { wrapper } = await mountMenu('copy')
    const trigger = wrapper.get('[data-testid="mermaid-copy"]')
    const item = wrapper.get('[data-testid="mermaid-export-copy-markdown"]')

    await item.trigger('click')
    await flushPromises()
    vi.advanceTimersByTime(1500)
    await item.trigger('click')
    await flushPromises()
    vi.advanceTimersByTime(1500)
    await flushPromises()

    expect(trigger.text()).toContain('Copied!')

    vi.advanceTimersByTime(500)
    await flushPromises()

    expect(trigger.text()).not.toContain('Copied!')
  })

  it.each(DOWNLOAD_ACTION_IDS)('shows no feedback after a successful %s',
    async (action) => {
      const { wrapper } = await mountMenu('download')

      await wrapper.get(`[data-testid="mermaid-export-${action}"]`)
        .trigger('click')
      await flushPromises()

      expect(wrapper.get('[data-testid="mermaid-download"]').text())
        .not.toContain('Copied!')
      expect(mocks.useErrorMessage).not.toHaveBeenCalled()
    })

  it('shows an error toast and no check when the export fails', async () => {
    mocks.runExportAction.mockResolvedValue(false)

    const { wrapper } = await mountMenu('copy')

    await wrapper.get('[data-testid="mermaid-export-copy-svg"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.useErrorMessage).toHaveBeenCalledWith(
      'Couldn\'t export diagram',
    )
    expect(wrapper.get('[data-testid="mermaid-copy"]').text())
      .not.toContain('Copied!')
  })

  it('reports a synchronous failure result', async () => {
    mocks.runExportAction.mockReturnValue(false)

    const { wrapper } = await mountMenu('download')

    await wrapper.get('[data-testid="mermaid-export-download-drawio"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.useErrorMessage).toHaveBeenCalledWith(
      'Couldn\'t export diagram',
    )
  })

  it('does not export when the theme element is unavailable', async () => {
    const { wrapper } = await mountMenu('copy', {
      themeElement: () => null,
    })

    await wrapper.get('[data-testid="mermaid-export-copy-svg"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.runExportAction).not.toHaveBeenCalled()
    expect(mocks.useErrorMessage).toHaveBeenCalledWith(
      'Couldn\'t export diagram',
    )
  })

  it('disables the download trigger while the svg is empty', async () => {
    const { wrapper } = await mountMenu('download', { svg: '' })

    expect(wrapper.get('[data-testid="mermaid-download"]').classes())
      .toContain('btn-disabled')

    await wrapper.get('[data-testid="mermaid-export-download-svg"]')
      .trigger('click')

    expect(mocks.runExportAction).not.toHaveBeenCalled()
  })

  it('keeps the source-only copy items enabled while the svg is empty',
    async () => {
      const { wrapper, themeElement } = await mountMenu('copy', { svg: '' })

      expect(wrapper.get('[data-testid="mermaid-copy"]').classes())
        .not.toContain('btn-disabled')

      for (const action of ['copy-svg', 'copy-drawio']) {
        expect(wrapper
          .get(`[data-testid="mermaid-export-${action}"]`)
          .attributes('disabled'))
          .toBeDefined()
      }

      for (const action of ['copy-source', 'copy-markdown']) {
        expect(wrapper
          .get(`[data-testid="mermaid-export-${action}"]`)
          .attributes('disabled'))
          .toBeUndefined()
      }

      await wrapper.get('[data-testid="mermaid-export-copy-source"]')
        .trigger('click')

      expect(mocks.runExportAction).toHaveBeenCalledWith('copy-source', {
        source: SOURCE,
        svg: '',
        themeElement,
      })
    })

  it('closes the dropdown after choosing an action', async () => {
    const { wrapper } = await mountMenu('download')
    const dropdown = wrapper.get('details').element as HTMLDetailsElement

    dropdown.open = true

    await wrapper.get('[data-testid="mermaid-export-download-svg"]')
      .trigger('click')
    await flushPromises()

    expect(dropdown.open).toBe(false)
  })

  it('closes the other open menu when one opens', async () => {
    const { wrapper: downloadMenu } = await mountMenu('download', {
      attachToBody: true,
    })
    const { wrapper: copyMenu } = await mountMenu('copy', {
      attachToBody: true,
    })
    const downloadDropdown = downloadMenu.get('details')
      .element as HTMLDetailsElement
    const copyDropdown = copyMenu.get('details').element as HTMLDetailsElement

    downloadDropdown.open = true
    downloadDropdown.dispatchEvent(new Event('toggle'))

    expect(downloadDropdown.open).toBe(true)
    expect(copyDropdown.open).toBe(false)

    copyDropdown.open = true
    copyDropdown.dispatchEvent(new Event('toggle'))

    expect(copyDropdown.open).toBe(true)
    expect(downloadDropdown.open).toBe(false)
  })

  it('keeps the menu open when its own toggle event closes it', async () => {
    const { wrapper: downloadMenu } = await mountMenu('download', {
      attachToBody: true,
    })
    const { wrapper: copyMenu } = await mountMenu('copy', {
      attachToBody: true,
    })
    const downloadDropdown = downloadMenu.get('details')
      .element as HTMLDetailsElement
    const copyDropdown = copyMenu.get('details').element as HTMLDetailsElement

    copyDropdown.open = true
    downloadDropdown.open = false
    downloadDropdown.dispatchEvent(new Event('toggle'))

    expect(copyDropdown.open).toBe(true)
  })

  it('closes on an outside click', async () => {
    const { wrapper } = await mountMenu('copy', { attachToBody: true })
    const dropdown = wrapper.get('details').element as HTMLDetailsElement

    dropdown.open = true

    document.body.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true }),
    )
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(dropdown.open).toBe(false)
  })

  it('exposes the open state through aria-expanded', async () => {
    const { wrapper } = await mountMenu('copy')
    const dropdown = wrapper.get('details').element as HTMLDetailsElement
    const trigger = wrapper.get('[data-testid="mermaid-copy"]')

    expect(trigger.attributes('aria-expanded')).toBe('false')

    dropdown.open = true
    dropdown.dispatchEvent(new Event('toggle'))
    await flushPromises()

    expect(trigger.attributes('aria-expanded')).toBe('true')

    dropdown.open = false
    dropdown.dispatchEvent(new Event('toggle'))
    await flushPromises()

    expect(trigger.attributes('aria-expanded')).toBe('false')
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const { wrapper } = await mountMenu('copy', { attachToBody: true })
    const dropdown = wrapper.get('details').element as HTMLDetailsElement
    const focus = vi.spyOn(wrapper.get('summary').element as HTMLElement, 'focus')

    dropdown.open = true
    dropdown.dispatchEvent(new Event('toggle'))

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })

    wrapper.get('[data-testid="mermaid-export-copy-source"]')
      .element.dispatchEvent(event)
    await flushPromises()

    expect(dropdown.open).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(focus).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="mermaid-copy"]')
      .attributes('aria-expanded')).toBe('false')
  })

  it('ignores Escape while the menu is closed', async () => {
    const { wrapper } = await mountMenu('copy', { attachToBody: true })
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })

    wrapper.get('summary').element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('returns focus to the trigger after choosing an item', async () => {
    const { wrapper } = await mountMenu('copy', { attachToBody: true })
    const dropdown = wrapper.get('details').element as HTMLDetailsElement
    const focus = vi.spyOn(wrapper.get('summary').element as HTMLElement, 'focus')

    dropdown.open = true

    await wrapper.get('[data-testid="mermaid-export-copy-markdown"]')
      .trigger('click')
    await flushPromises()

    expect(dropdown.open).toBe(false)
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('refuses to toggle a disabled trigger and marks it aria-disabled',
    async () => {
      const { wrapper } = await mountMenu('download', { svg: '' })
      const trigger = wrapper.get('[data-testid="mermaid-download"]')
      const click = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      })

      expect(trigger.attributes('aria-disabled')).toBe('true')

      trigger.element.dispatchEvent(click)

      expect(click.defaultPrevented).toBe(true)
    })

  it('leaves an enabled trigger toggleable', async () => {
    const { wrapper } = await mountMenu('download')
    const trigger = wrapper.get('[data-testid="mermaid-download"]')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })

    expect(trigger.attributes('aria-disabled')).toBeUndefined()

    trigger.element.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(false)
  })

  it('closes an open menu when it becomes disabled', async () => {
    const { wrapper } = await mountMenu('download')
    const dropdown = wrapper.get('details').element as HTMLDetailsElement

    dropdown.open = true

    await wrapper.setProps({
      input: {
        source: SOURCE,
        svg: '',
        themeElement: () => null,
      },
    })

    expect(dropdown.open).toBe(false)
  })

  it('announces a copy through a polite status region and clears it',
    async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      const { wrapper } = await mountMenu('copy')
      const status = wrapper.get('[data-testid="mermaid-menu-status"]')

      expect(status.attributes('role')).toBe('status')
      expect(status.attributes('aria-live')).toBe('polite')
      expect(status.classes()).toContain('sr-only')
      expect(status.text()).toBe('')

      await wrapper.get('[data-testid="mermaid-export-copy-svg"]')
        .trigger('click')
      await flushPromises()

      expect(status.text()).toBe('Copied')

      vi.advanceTimersByTime(2000)
      await flushPromises()

      expect(status.text()).toBe('')
    })

  it('keeps the status region outside the closed details element',
    async () => {
      const { wrapper } = await mountMenu('copy')

      expect(wrapper.get('details')
        .find('[data-testid="mermaid-menu-status"]').exists()).toBe(false)
    })

  it('announces the failure message when the export fails', async () => {
    mocks.runExportAction.mockResolvedValue(false)

    const { wrapper } = await mountMenu('download')

    await wrapper.get('[data-testid="mermaid-export-download-svg"]')
      .trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="mermaid-menu-status"]').text())
      .toBe('Couldn\'t export diagram')
  })

  describe('keeping the menu inside its clipping block', () => {
    const BLOCK_RIGHT = 300
    const CONTENT_WIDTH = 176

    function rect(left: number, right: number): DOMRect {
      return {
        left,
        right,
        top: 0,
        bottom: 0,
        x: left,
        y: 0,
        width: right - left,
        height: 0,
        toJSON: () => ({}),
      }
    }

    async function openInBlock(
      menuLeft: number,
      contentOffsetLeft: number,
    ) {
      const block = document.createElement('div')

      block.style.overflowX = 'clip'
      document.body.append(block)
      vi.spyOn(block, 'getBoundingClientRect')
        .mockReturnValue(rect(0, BLOCK_RIGHT))

      const wrapper = await mountSuspended(MermaidActionMenu, {
        props: {
          label: 'Copy',
          icon: 'lucide:copy',
          testId: 'mermaid-copy',
          actions: MERMAID_COPY_ACTIONS,
          input: {
            source: SOURCE,
            svg: SVG,
            themeElement: () => document.createElement('div'),
          },
        },
        attachTo: block,
      })

      mountedWrappers.push(wrapper)

      const dropdown = wrapper.get('details').element as HTMLDetailsElement
      const content = wrapper.get('.dropdown-content').element as HTMLElement

      vi.spyOn(dropdown, 'getBoundingClientRect')
        .mockReturnValue(rect(menuLeft, menuLeft + 40))
      Object.defineProperty(content, 'offsetLeft', {
        value: contentOffsetLeft,
      })
      Object.defineProperty(content, 'offsetWidth', {
        value: CONTENT_WIDTH,
      })

      dropdown.open = true
      dropdown.dispatchEvent(new Event('toggle'))

      return { content, block }
    }

    it('shifts a menu that overflows the right edge back inside',
      async () => {
        const { content, block } = await openInBlock(260, -136 + 16)

        expect(content.style.translate).toBe('-20px')

        block.remove()
      })

    it('shifts a menu that overflows the left edge back inside', async () => {
      const { content, block } = await openInBlock(10, -136)

      expect(content.style.translate).toBe('130px')

      block.remove()
    })

    it('leaves a menu that already fits untouched', async () => {
      const { content, block } = await openInBlock(200, -136)

      expect(content.style.translate).toBe('')

      block.remove()
    })
  })
})
