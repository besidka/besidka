import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import MermaidExportMenu from '../../../../app/components/prose/MermaidExportMenu.vue'
import type { DiagramExportAction } from '../../../../app/types/diagram-export.d'

const mocks = vi.hoisted(() => {
  return {
    runExportAction: vi.fn(),
    useSuccessMessage: vi.fn(),
    useErrorMessage: vi.fn(),
  }
})

mockNuxtImport('useDiagramExport', () => {
  return () => {
    return { runExportAction: mocks.runExportAction }
  }
})

mockNuxtImport('useSuccessMessage', () => mocks.useSuccessMessage)
mockNuxtImport('useErrorMessage', () => mocks.useErrorMessage)

const SOURCE = 'flowchart LR\n  A --> B'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'

const ACTIONS: DiagramExportAction[] = [
  'copy-svg',
  'copy-markdown',
  'copy-drawio',
  'download-svg',
  'download-png',
  'download-drawio',
  'open-drawio',
]

async function mountMenu(
  options: {
    svg?: string
    themeElement?: () => HTMLElement | null
  } = {},
) {
  const themeElement = document.createElement('div')

  const wrapper = await mountSuspended(MermaidExportMenu, {
    props: {
      source: SOURCE,
      svg: options.svg ?? SVG,
      themeElement: options.themeElement ?? (() => themeElement),
    },
  })

  return { wrapper, themeElement }
}

describe('prose/MermaidExportMenu.vue', () => {
  beforeEach(() => {
    mocks.runExportAction.mockReset()
    mocks.runExportAction.mockResolvedValue(true)
    mocks.useSuccessMessage.mockReset()
    mocks.useErrorMessage.mockReset()
  })

  it('renders the three groups with all seven actions', async () => {
    const { wrapper } = await mountMenu()

    expect(wrapper.get('[data-testid="mermaid-export"]').text())
      .toContain('Export')

    for (const action of ACTIONS) {
      expect(wrapper.find(`[data-testid="mermaid-export-${action}"]`).exists())
        .toBe(true)
    }

    expect(wrapper.findAll('.menu-title').map((title) => {
      return title.text()
    })).toEqual(['Copy', 'Download', 'Open'])
  })

  it.each(ACTIONS)('runs %s synchronously inside the click handler',
    async (action) => {
      const { wrapper, themeElement } = await mountMenu()
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

  it.each([
    ['copy-svg', 'SVG copied'],
    ['copy-markdown', 'Markdown copied'],
    ['copy-drawio', 'Copied for draw.io — paste into draw.io'],
  ])('shows a success toast after %s', async (action, message) => {
    const { wrapper } = await mountMenu()

    await wrapper.get(`[data-testid="mermaid-export-${action}"]`)
      .trigger('click')
    await flushPromises()

    expect(mocks.useSuccessMessage).toHaveBeenCalledWith(message)
    expect(mocks.useErrorMessage).not.toHaveBeenCalled()
  })

  it.each([
    'download-svg',
    'download-png',
    'download-drawio',
    'open-drawio',
  ])('shows no toast after a successful %s', async (action) => {
    const { wrapper } = await mountMenu()

    await wrapper.get(`[data-testid="mermaid-export-${action}"]`)
      .trigger('click')
    await flushPromises()

    expect(mocks.useSuccessMessage).not.toHaveBeenCalled()
    expect(mocks.useErrorMessage).not.toHaveBeenCalled()
  })

  it('shows an error toast when the export fails', async () => {
    mocks.runExportAction.mockResolvedValue(false)

    const { wrapper } = await mountMenu()

    await wrapper.get('[data-testid="mermaid-export-copy-svg"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.useErrorMessage).toHaveBeenCalledWith(
      'Couldn\'t export diagram',
    )
    expect(mocks.useSuccessMessage).not.toHaveBeenCalled()
  })

  it('reports a synchronous failure result', async () => {
    mocks.runExportAction.mockReturnValue(false)

    const { wrapper } = await mountMenu()

    await wrapper.get('[data-testid="mermaid-export-open-drawio"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.useErrorMessage).toHaveBeenCalledWith(
      'Couldn\'t export diagram',
    )
  })

  it('does not export when the theme element is unavailable', async () => {
    const { wrapper } = await mountMenu({ themeElement: () => null })

    await wrapper.get('[data-testid="mermaid-export-copy-svg"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.runExportAction).not.toHaveBeenCalled()
    expect(mocks.useErrorMessage).toHaveBeenCalledWith(
      'Couldn\'t export diagram',
    )
  })

  it('is disabled while the svg is empty', async () => {
    const { wrapper } = await mountMenu({ svg: '' })

    expect(wrapper.get('[data-testid="mermaid-export"]').classes())
      .toContain('btn-disabled')

    await wrapper.get('[data-testid="mermaid-export-copy-svg"]')
      .trigger('click')

    expect(mocks.runExportAction).not.toHaveBeenCalled()
  })

  it('closes the dropdown after choosing an action', async () => {
    const { wrapper } = await mountMenu()
    const dropdown = wrapper.get('details').element as HTMLDetailsElement

    dropdown.open = true

    await wrapper.get('[data-testid="mermaid-export-download-svg"]')
      .trigger('click')
    await flushPromises()

    expect(dropdown.open).toBe(false)
  })
})
