import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import PreStream from '../../../../app/components/prose/PreStream.vue'
import { markdownSourceKey } from '../../../../app/composables/markdown-source'
import type { MarkdownSourceContext } from '../../../../app/composables/markdown-source'

const mocks = vi.hoisted(() => {
  const panzoomInstance = {
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    reset: vi.fn(),
    destroy: vi.fn(),
    setOptions: vi.fn(),
    zoomWithWheel: vi.fn(),
  }

  return {
    copy: vi.fn(),
    renderAsync: vi.fn(),
    runExportAction: vi.fn(),
    panzoom: vi.fn(() => panzoomInstance),
  }
})

vi.mock('@panzoom/panzoom', () => {
  return { default: mocks.panzoom }
})

mockNuxtImport('useDiagramExport', () => {
  return () => {
    return { runExportAction: mocks.runExportAction }
  }
})

mockNuxtImport('useHighlighter', () => {
  return async () => {
    return { getLoadedLanguages: () => [] as string[] }
  }
})

mockNuxtImport('useClipboard', () => {
  return () => {
    return { copy: mocks.copy }
  }
})

vi.mock('pele/lazy', async () => {
  const actual = await vi.importActual<typeof import('pele/lazy')>(
    'pele/lazy',
  )

  return { ...actual, renderAsync: mocks.renderAsync }
})

vi.mock('shiki-stream/vue', async () => {
  const { defineComponent, h } = await import('vue')

  return {
    ShikiCachedRenderer: defineComponent({
      props: {
        code: { type: String, default: '' },
        lang: { type: String, default: '' },
        theme: { type: String, default: '' },
        highlighter: { type: Object, default: null },
      },
      setup(props) {
        return () => {
          return h('code', { 'data-testid': 'shiki-code' }, props.code)
        }
      },
    }),
  }
})

const VALID_DIAGRAM = 'flowchart LR\n  A[Start] --> B[Done]\n  B --> C[End]'
const INVALID_DIAGRAM = 'flowchart LR\n  A[Start --> B\n  B --> C'

const VIEWER_SELECTOR = '[data-testid="mermaid-viewer"]'

async function mountPre(
  code: string,
  options: {
    language?: string
    context?: MarkdownSourceContext
    attachTo?: HTMLElement
  } = {},
): Promise<VueWrapper> {
  const provide: Record<symbol, () => MarkdownSourceContext> = {}

  if (options.context) {
    const context = options.context

    provide[markdownSourceKey as symbol] = () => context
  }

  return mountSuspended(PreStream, {
    attachTo: options.attachTo,
    props: {
      code,
      language: options.language ?? 'mermaid',
    },
    global: {
      provide,
      stubs: { teleport: true },
    },
  })
}

function findButton(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find((button) => {
    return button.text().includes(text)
  })
}

async function waitForDiagram(wrapper: VueWrapper): Promise<void> {
  await vi.waitFor(() => {
    expect(
      wrapper.find('[data-testid="mermaid-diagram"] svg').exists(),
    ).toBe(true)
  })
}

describe('prose/PreStream.vue mermaid', () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('pele/lazy')>(
      'pele/lazy',
    )

    mocks.renderAsync.mockImplementation(actual.renderAsync)
    mocks.copy.mockReset()
    mocks.runExportAction.mockReset()
  })

  it('renders a valid complete diagram as an svg', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)

    expect(wrapper.find('[data-testid="shiki-code"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mermaid-error"]').exists()).toBe(false)
    expect(mocks.renderAsync).toHaveBeenCalledTimes(1)
  })

  it('copies the diagram source from the Copy menu rather than the svg',
    async () => {
      mocks.runExportAction.mockResolvedValue(true)

      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)
      await wrapper.get('[data-testid="mermaid-export-copy-source"]')
        .trigger('click')

      expect(mocks.runExportAction).toHaveBeenCalledWith(
        'copy-source',
        expect.objectContaining({ source: VALID_DIAGRAM }),
      )
      expect(mocks.copy).not.toHaveBeenCalled()
      expect(findButton(wrapper, 'Copy')).toBeUndefined()
    })

  it('hides the expand button and the height clamp in diagram view',
    async () => {
      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)

      expect(findButton(wrapper, 'Expand')).toBeUndefined()
      expect(wrapper.html()).not.toContain('max-h-30')

      await wrapper.get('[data-testid="mermaid-toggle"]').trigger('click')

      expect(findButton(wrapper, 'Expand')).toBeDefined()
      expect(wrapper.html()).toContain('max-h-30')
    })

  it('falls back to the code block with an error note on invalid syntax',
    async () => {
      const wrapper = await mountPre(INVALID_DIAGRAM)

      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="mermaid-error"]').exists())
          .toBe(true)
      })

      expect(wrapper.get('[data-testid="mermaid-error"]').text())
        .toContain('Couldn\'t render diagram')
      expect(wrapper.get('[data-testid="mermaid-error"]').text())
        .toMatch(/\(line \d+/)
      expect(wrapper.find('[data-testid="mermaid-diagram"]').exists())
        .toBe(false)
      expect(wrapper.get('[data-testid="shiki-code"]').text())
        .toBe(INVALID_DIAGRAM)
      expect(wrapper.find('[data-testid="mermaid-toggle"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="mermaid-copy"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="mermaid-download"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="mermaid-fullscreen"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="mermaid-edit"]').exists()).toBe(true)
    })

  it('keeps the plain Copy button for a mermaid block that failed to render',
    async () => {
      const wrapper = await mountPre(INVALID_DIAGRAM)

      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="mermaid-error"]').exists())
          .toBe(true)
      })

      await findButton(wrapper, 'Copy')!.trigger('click')

      expect(mocks.copy).toHaveBeenCalledWith(INVALID_DIAGRAM)
      expect(findButton(wrapper, 'Copied!')).toBeDefined()
      expect(mocks.runExportAction).not.toHaveBeenCalled()
    })

  it('clears the error note and renders once the code becomes valid',
    async () => {
      const wrapper = await mountPre(INVALID_DIAGRAM)

      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="mermaid-error"]').exists())
          .toBe(true)
      })

      await wrapper.setProps({ code: VALID_DIAGRAM })
      await waitForDiagram(wrapper)

      expect(wrapper.find('[data-testid="mermaid-error"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="shiki-code"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="mermaid-toggle"]').exists())
        .toBe(true)
    })

  it('truncates a very long error message', async () => {
    mocks.renderAsync.mockRejectedValueOnce(new Error('x'.repeat(500)))

    const wrapper = await mountPre('flowchart LR\n  LongError --> B')

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="mermaid-error"]').exists())
        .toBe(true)
    })

    const text = wrapper.get('[data-testid="mermaid-error"]').text()

    expect(text).toContain(`${'x'.repeat(200)}…`)
    expect(text).not.toContain('x'.repeat(201))
  })

  it('shows plain code and renders nothing while the fence is open',
    async () => {
      const wrapper = await mountPre('flowchart LR\n  A --> B', {
        context: {
          streaming: true,
          source: '```mermaid\nflowchart LR\n  A --> B',
        },
      })

      await flushPromises()

      expect(mocks.renderAsync).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="mermaid-diagram"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="mermaid-toggle"]').exists())
        .toBe(false)
      expect(wrapper.get('[data-testid="shiki-code"]').text())
        .toBe('flowchart LR\n  A --> B')
      expect(wrapper.find('[data-testid="mermaid-edit"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="mermaid-copy"]').exists())
        .toBe(false)
      expect(findButton(wrapper, 'Copy')).toBeDefined()
    })

  it('renders the diagram while streaming once the fence is closed',
    async () => {
      const wrapper = await mountPre('flowchart LR\n  A --> B', {
        context: {
          streaming: true,
          source: '```mermaid\nflowchart LR\n  A --> B\n```\n\nMore text',
        },
      })

      await waitForDiagram(wrapper)
    })

  it('does not render a half-received diagram when the rendered code '
    + 'lags behind a closed fence', async () => {
    const wrapper = await mountPre('flowchart LR\n  A', {
      context: {
        streaming: true,
        source: '```mermaid\nflowchart LR\n  A --> B\n```',
      },
    })

    await flushPromises()

    expect(mocks.renderAsync).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="mermaid-diagram"]').exists())
      .toBe(false)
  })

  it('renders the diagram when streaming ends', async () => {
    const wrapper = await mountPre('flowchart LR\n  A --> B', {
      context: { streaming: false, source: '' },
    })

    await waitForDiagram(wrapper)
  })

  it('toggles between diagram and code views', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)

    const toggle = wrapper.get('[data-testid="mermaid-toggle"]')

    expect(toggle.text()).toContain('Code')

    await toggle.trigger('click')

    expect(wrapper.find('[data-testid="mermaid-diagram"]').exists())
      .toBe(false)
    expect(wrapper.get('[data-testid="shiki-code"]').text())
      .toBe(VALID_DIAGRAM)
    expect(wrapper.get('[data-testid="mermaid-toggle"]').text())
      .toContain('Diagram')

    await wrapper.get('[data-testid="mermaid-toggle"]').trigger('click')
    await waitForDiagram(wrapper)

    expect(wrapper.find('[data-testid="shiki-code"]').exists()).toBe(false)
  })

  it('leaves non-mermaid blocks untouched', async () => {
    const wrapper = await mountPre('const answer = 42', {
      language: 'ts',
    })

    await flushPromises()

    expect(mocks.renderAsync).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="mermaid-toggle"]').exists())
      .toBe(false)
    expect(wrapper.get('[data-testid="shiki-code"]').text())
      .toBe('const answer = 42')
  })

  it('keeps the plain Copy button on non-mermaid blocks', async () => {
    const wrapper = await mountPre('const answer = 42', {
      language: 'ts',
    })

    await flushPromises()

    expect(wrapper.find('[data-testid="mermaid-copy"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mermaid-download"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="mermaid-edit"]').exists()).toBe(false)

    await findButton(wrapper, 'Copy')!.trigger('click')

    expect(mocks.copy).toHaveBeenCalledWith('const answer = 42')
    expect(findButton(wrapper, 'Copied!')).toBeDefined()
    expect(mocks.runExportAction).not.toHaveBeenCalled()
  })
})

describe('prose/PreStream.vue mermaid viewer and export', () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('pele/lazy')>(
      'pele/lazy',
    )

    mocks.renderAsync.mockImplementation(actual.renderAsync)
    mocks.panzoom.mockClear()
    mocks.runExportAction.mockReset()
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function () {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function () {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the toolbar in order in diagram view', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)

    const order = [
      'mermaid-toggle',
      'mermaid-edit',
      'mermaid-fullscreen',
      'mermaid-download',
      'mermaid-copy',
    ]
    const positions = order.map((testId) => {
      const element = wrapper.find(`[data-testid="${testId}"]`)

      expect(element.exists()).toBe(true)

      return Array.from(wrapper.element.querySelectorAll('[data-testid]'))
        .indexOf(element.element)
    })

    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(wrapper.find('[data-testid="mermaid-export"]').exists())
      .toBe(false)
    expect(findButton(wrapper, 'Copy')).toBeUndefined()
    expect(wrapper.find('[data-testid="mermaid-edited-badge"]').exists())
      .toBe(false)
  })

  it('keeps the fullscreen button and both menus in code view',
    async () => {
      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)
      await wrapper.get('[data-testid="mermaid-toggle"]').trigger('click')

      expect(wrapper.find('[data-testid="mermaid-fullscreen"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="mermaid-download"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="mermaid-copy"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="mermaid-edit"]').exists())
        .toBe(true)
      expect(wrapper.get('[data-testid="mermaid-download"]').classes())
        .not.toContain('btn-disabled')
    })

  it('exports from code view with the theme host and the rendered svg',
    async () => {
      mocks.runExportAction.mockResolvedValue(true)

      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)
      await wrapper.get('[data-testid="mermaid-toggle"]').trigger('click')
      await wrapper.get('[data-testid="mermaid-export-download-svg"]')
        .trigger('click')

      expect(mocks.runExportAction).toHaveBeenCalledWith(
        'download-svg',
        {
          source: VALID_DIAGRAM,
          svg: expect.stringContaining('<svg'),
          themeElement: wrapper.get('[data-testid="mermaid-theme-host"]')
            .element,
        },
      )
    })

  it('never shows the mermaid toolbar actions on code blocks',
    async () => {
      const wrapper = await mountPre('const answer = 42', {
        language: 'ts',
      })

      await flushPromises()

      for (const testId of [
        'mermaid-fullscreen',
        'mermaid-download',
        'mermaid-copy',
        'mermaid-edit',
      ]) {
        expect(wrapper.find(`[data-testid="${testId}"]`).exists())
          .toBe(false)
      }

      expect(wrapper.get('[data-testid="mermaid-theme-host"]').classes())
        .not.toContain('pele-theme')
    })

  it('uses icon-only toolbar buttons below the sm breakpoint', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)

    const labels = [
      wrapper.get('[data-testid="mermaid-fullscreen"]'),
      wrapper.get('[data-testid="mermaid-download"]'),
      wrapper.get('[data-testid="mermaid-copy"]'),
      wrapper.get('[data-testid="mermaid-toggle"]'),
      wrapper.get('[data-testid="mermaid-edit"]'),
    ]

    for (const label of labels) {
      expect(label.html()).toContain('max-sm:sr-only')
    }
  })

  it('opens the viewer from the fullscreen button', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)

    expect(wrapper.find(VIEWER_SELECTOR).exists()).toBe(false)

    await wrapper.get('[data-testid="mermaid-fullscreen"]').trigger('click')

    await vi.waitFor(() => {
      expect(wrapper.find(VIEWER_SELECTOR).exists()).toBe(true)
    })

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
  })

  it('opens the viewer when the inline diagram is clicked', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)

    const diagram = wrapper.get('[data-testid="mermaid-diagram"]')

    expect(diagram.attributes('role')).toBeUndefined()
    expect(diagram.attributes('tabindex')).toBeUndefined()

    await diagram.trigger('click')

    await vi.waitFor(() => {
      expect(wrapper.find(VIEWER_SELECTOR).exists()).toBe(true)
    })
  })

  it('opens the viewer from the keyboard on the inline diagram',
    async () => {
      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)

      const openButton = wrapper.get('[data-testid="mermaid-diagram-open"]')

      expect(openButton.element.tagName).toBe('BUTTON')
      expect(openButton.text()).toBe('Open diagram in fullscreen')

      await openButton.trigger('click')

      await vi.waitFor(() => {
        expect(wrapper.find(VIEWER_SELECTOR).exists()).toBe(true)
      })
    })

  it('hides the inline svg while the viewer is open and unmounts it on '
    + 'close', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)

    expect(wrapper.get('[data-testid="mermaid-diagram"]').classes())
      .not.toContain('invisible')

    await wrapper.get('[data-testid="mermaid-fullscreen"]').trigger('click')

    await vi.waitFor(() => {
      expect(wrapper.find(VIEWER_SELECTOR).exists()).toBe(true)
    })

    expect(wrapper.get('[data-testid="mermaid-diagram"]').classes())
      .toContain('invisible')

    wrapper.get('[data-testid="mermaid-viewer-close"]')
      .element.closest('dialog')!
      .dispatchEvent(new Event('close'))

    await vi.waitFor(() => {
      expect(wrapper.find(VIEWER_SELECTOR).exists()).toBe(false)
    })

    expect(wrapper.get('[data-testid="mermaid-diagram"]').classes())
      .not.toContain('invisible')
  })

  it('exports the rendered svg with the diagram source', async () => {
    mocks.runExportAction.mockResolvedValue(true)

    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await wrapper.get('[data-testid="mermaid-export-copy-markdown"]')
      .trigger('click')

    expect(mocks.runExportAction).toHaveBeenCalledWith(
      'copy-markdown',
      expect.objectContaining({
        source: VALID_DIAGRAM,
        svg: expect.stringContaining('<svg'),
        themeElement: wrapper.get('[data-testid="mermaid-theme-host"]')
          .element,
      }),
    )
  })
})

const EDITED_DIAGRAM = 'flowchart LR\n  A[Begin] --> B[Done]\n  B --> C[End]'
const INVALID_EDIT = 'flowchart LR\n  A[Begin --> B'
const EDITOR_SELECTOR = '[data-testid="mermaid-editor"]'
const DIAGRAM_SELECTOR = '[data-testid="mermaid-diagram"]'
const COMMIT_DEBOUNCE_MS = 250

function fakeTimeoutTimers(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
}

async function startEditing(wrapper: VueWrapper): Promise<void> {
  await wrapper.get('[data-testid="mermaid-edit"]').trigger('click')
  await vi.waitFor(() => {
    expect(wrapper.find(EDITOR_SELECTOR).exists()).toBe(true)
  })
}

async function typeInEditor(
  wrapper: VueWrapper,
  text: string,
): Promise<void> {
  fakeTimeoutTimers()

  try {
    await wrapper.get(EDITOR_SELECTOR).setValue(text)
    await vi.advanceTimersByTimeAsync(COMMIT_DEBOUNCE_MS)
  } finally {
    vi.useRealTimers()
  }
}

async function waitForDiagramText(
  wrapper: VueWrapper,
  text: string,
): Promise<void> {
  await vi.waitFor(() => {
    expect(wrapper.get(DIAGRAM_SELECTOR).text()).toContain(text)
  })
}

function getEditor(wrapper: VueWrapper): HTMLTextAreaElement {
  return wrapper.get(EDITOR_SELECTOR).element as HTMLTextAreaElement
}

describe('prose/PreStream.vue mermaid editing', () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('pele/lazy')>(
      'pele/lazy',
    )

    mocks.renderAsync.mockImplementation(actual.renderAsync)
    mocks.copy.mockReset()
    mocks.runExportAction.mockReset()
    mocks.runExportAction.mockResolvedValue(true)
    mocks.panzoom.mockClear()
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function () {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function () {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('offers Edit only once the fence is complete', async () => {
    const streaming = await mountPre('flowchart LR\n  A --> B', {
      context: {
        streaming: true,
        source: '```mermaid\nflowchart LR\n  A --> B',
      },
    })

    await flushPromises()

    expect(streaming.find('[data-testid="mermaid-edit"]').exists())
      .toBe(false)

    const complete = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(complete)

    expect(complete.get('[data-testid="mermaid-edit"]').text())
      .toContain('Edit')
  })

  it('enters edit mode with the source above the live diagram', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await startEditing(wrapper)

    const editor = getEditor(wrapper)
    const diagram = wrapper.get(DIAGRAM_SELECTOR).element

    expect(editor.value).toBe(VALID_DIAGRAM)
    expect(editor.compareDocumentPosition(diagram)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wrapper.find('[data-testid="mermaid-edit"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mermaid-toggle"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="mermaid-edit-done"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="mermaid-edit-reset"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="mermaid-fullscreen"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="mermaid-download"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="mermaid-copy"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="shiki-code"]').exists()).toBe(false)
  })

  it('hides the window dots on phones while editing to keep one row',
    async () => {
      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)

      expect(wrapper.get('[data-testid="mermaid-window-dots"]').classes())
        .not.toContain('max-sm:hidden')

      await startEditing(wrapper)

      expect(wrapper.get('[data-testid="mermaid-window-dots"]').classes())
        .toContain('max-sm:hidden')
    })

  it('enters edit mode straight from code view', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await wrapper.get('[data-testid="mermaid-toggle"]').trigger('click')
    await startEditing(wrapper)
    await waitForDiagram(wrapper)

    expect(wrapper.find('[data-testid="shiki-code"]').exists()).toBe(false)
  })

  it('re-renders the diagram from the edited text after the debounce',
    async () => {
      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)
      await startEditing(wrapper)

      mocks.renderAsync.mockClear()
      fakeTimeoutTimers()

      await wrapper.get(EDITOR_SELECTOR).setValue(EDITED_DIAGRAM)
      await vi.advanceTimersByTimeAsync(COMMIT_DEBOUNCE_MS - 1)

      expect(mocks.renderAsync).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      vi.useRealTimers()
      await waitForDiagramText(wrapper, 'Begin')

      expect(mocks.renderAsync).toHaveBeenCalledTimes(1)
      expect(mocks.renderAsync.mock.calls[0]![0]).toBe(EDITED_DIAGRAM)
      expect(wrapper.get(DIAGRAM_SELECTOR).text()).not.toContain('Start')
    })

  it('keeps the last diagram dimmed with an error note on invalid syntax',
    async () => {
      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)
      await startEditing(wrapper)
      await typeInEditor(wrapper, INVALID_EDIT)

      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="mermaid-error"]').exists())
          .toBe(true)
      })

      const errorNote = wrapper.get('[data-testid="mermaid-error"]')

      expect(errorNote.text()).toContain('Couldn\'t render diagram')
      expect(errorNote.text()).toMatch(/\(line \d+/)
      expect(wrapper.find(EDITOR_SELECTOR).exists()).toBe(true)
      expect(getEditor(wrapper).value).toBe(INVALID_EDIT)
      expect(wrapper.get(DIAGRAM_SELECTOR).classes()).toContain('opacity-60')
      expect(wrapper.get(DIAGRAM_SELECTOR).text()).toContain('Start')
      expect(wrapper.find('[data-testid="shiki-code"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="mermaid-edit-done"]').exists())
        .toBe(true)

      const editor = wrapper.get(EDITOR_SELECTOR).element
      const note = errorNote.element

      expect(editor.compareDocumentPosition(note)
        & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(note.compareDocumentPosition(wrapper.get(DIAGRAM_SELECTOR).element)
        & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

  it('clears the error note and dimming once the edit becomes valid',
    async () => {
      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)
      await startEditing(wrapper)
      await typeInEditor(wrapper, INVALID_EDIT)

      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="mermaid-error"]').exists())
          .toBe(true)
      })

      await typeInEditor(wrapper, EDITED_DIAGRAM)
      await waitForDiagramText(wrapper, 'Begin')

      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="mermaid-error"]').exists())
          .toBe(false)
      })

      expect(wrapper.get(DIAGRAM_SELECTOR).classes())
        .not.toContain('opacity-60')
    })

  it('shows Reset only while the text differs and restores the original',
    async () => {
      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)
      await startEditing(wrapper)

      expect(wrapper.find('[data-testid="mermaid-edit-reset"]').exists())
        .toBe(false)

      await typeInEditor(wrapper, EDITED_DIAGRAM)
      await waitForDiagramText(wrapper, 'Begin')

      expect(wrapper.find('[data-testid="mermaid-edit-reset"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="mermaid-edited-badge"]').exists())
        .toBe(true)

      await wrapper.get('[data-testid="mermaid-edit-reset"]')
        .trigger('click')
      await waitForDiagramText(wrapper, 'Start')

      expect(getEditor(wrapper).value).toBe(VALID_DIAGRAM)
      expect(wrapper.find('[data-testid="mermaid-edit-reset"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="mermaid-edited-badge"]').exists())
        .toBe(false)
      expect(wrapper.get(DIAGRAM_SELECTOR).text()).not.toContain('Begin')
    })

  it('hides the Edited badge when the text is typed back to the original',
    async () => {
      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)
      await startEditing(wrapper)
      await typeInEditor(wrapper, EDITED_DIAGRAM)

      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="mermaid-edited-badge"]').exists())
          .toBe(true)
      })

      await typeInEditor(wrapper, VALID_DIAGRAM)

      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="mermaid-edited-badge"]').exists())
          .toBe(false)
      })
    })

  it('keeps the edits after Done and shows the Edited badge', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await startEditing(wrapper)
    await typeInEditor(wrapper, EDITED_DIAGRAM)
    await waitForDiagramText(wrapper, 'Begin')
    await wrapper.get('[data-testid="mermaid-edit-done"]').trigger('click')

    expect(wrapper.find(EDITOR_SELECTOR).exists()).toBe(false)
    expect(wrapper.find('[data-testid="mermaid-edit-done"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="mermaid-edit-reset"]').exists())
      .toBe(true)
    expect(wrapper.get('[data-testid="mermaid-edited-badge"]').text())
      .toBe('Edited')
    expect(wrapper.get('[data-testid="mermaid-edited-badge"]').classes())
      .toEqual(expect.arrayContaining(['badge', 'badge-sm']))
    expect(wrapper.get('[data-testid="mermaid-window-dots"]').classes())
      .toContain('max-sm:hidden')
    expect(wrapper.find('[data-testid="mermaid-toggle"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mermaid-edit"]').exists()).toBe(true)
    expect(wrapper.get(DIAGRAM_SELECTOR).text()).toContain('Begin')
  })

  it('does not drop an edit made right before Done', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await startEditing(wrapper)
    await wrapper.get(EDITOR_SELECTOR).setValue(EDITED_DIAGRAM)
    await wrapper.get('[data-testid="mermaid-edit-done"]').trigger('click')

    await waitForDiagramText(wrapper, 'Begin')

    expect(wrapper.find('[data-testid="mermaid-edited-badge"]').exists())
      .toBe(true)
  })

  it('shows the edited text in code view', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await startEditing(wrapper)
    await typeInEditor(wrapper, EDITED_DIAGRAM)
    await waitForDiagramText(wrapper, 'Begin')
    await wrapper.get('[data-testid="mermaid-edit-done"]').trigger('click')
    await wrapper.get('[data-testid="mermaid-toggle"]').trigger('click')

    expect(wrapper.get('[data-testid="shiki-code"]').text())
      .toBe(EDITED_DIAGRAM)
    expect(wrapper.find('[data-testid="mermaid-edited-badge"]').exists())
      .toBe(true)
  })

  it('exports the edited source and its rendered svg', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await startEditing(wrapper)
    await typeInEditor(wrapper, EDITED_DIAGRAM)
    await waitForDiagramText(wrapper, 'Begin')

    for (const action of [
      'copy-source',
      'copy-markdown',
      'copy-svg',
      'copy-drawio',
      'download-svg',
      'download-png',
      'download-drawio',
    ]) {
      await wrapper.get(`[data-testid="mermaid-export-${action}"]`)
        .trigger('click')

      expect(mocks.runExportAction).toHaveBeenLastCalledWith(action, {
        source: EDITED_DIAGRAM,
        svg: expect.stringContaining('Begin'),
        themeElement: wrapper.get('[data-testid="mermaid-theme-host"]')
          .element,
      })
    }
  })

  it('exports the edited source from code view after Done', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await startEditing(wrapper)
    await typeInEditor(wrapper, EDITED_DIAGRAM)
    await waitForDiagramText(wrapper, 'Begin')
    await wrapper.get('[data-testid="mermaid-edit-done"]').trigger('click')
    await wrapper.get('[data-testid="mermaid-toggle"]').trigger('click')
    await wrapper.get('[data-testid="mermaid-export-copy-markdown"]')
      .trigger('click')

    expect(mocks.runExportAction).toHaveBeenLastCalledWith(
      'copy-markdown',
      expect.objectContaining({
        source: EDITED_DIAGRAM,
        svg: expect.stringContaining('Begin'),
      }),
    )
  })

  it('withholds the svg exports while the edited source is invalid',
    async () => {
      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)
      await startEditing(wrapper)
      await typeInEditor(wrapper, INVALID_EDIT)

      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="mermaid-error"]').exists())
          .toBe(true)
      })

      expect(wrapper.get('[data-testid="mermaid-download"]').classes())
        .toContain('btn-disabled')
      expect(wrapper.get('[data-testid="mermaid-fullscreen"]').classes())
        .toContain('btn-disabled')
      expect(wrapper
        .get('[data-testid="mermaid-export-copy-svg"]')
        .attributes('disabled')).toBeDefined()

      await wrapper.get('[data-testid="mermaid-export-copy-source"]')
        .trigger('click')

      expect(mocks.runExportAction).toHaveBeenLastCalledWith(
        'copy-source',
        expect.objectContaining({ source: INVALID_EDIT, svg: '' }),
      )
    })

  it('opens the fullscreen viewer with the edited source', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await startEditing(wrapper)
    await typeInEditor(wrapper, EDITED_DIAGRAM)
    await waitForDiagramText(wrapper, 'Begin')
    await flushPromises()
    await wrapper.get('[data-testid="mermaid-fullscreen"]').trigger('click')

    await vi.waitFor(() => {
      expect(wrapper.get('[data-testid="mermaid-viewer-target"]').text())
        .toContain('Begin')
    })

    expect(wrapper.get('[data-testid="mermaid-viewer-target"]').text())
      .not.toContain('Start')
  })

  it('exits edit mode on Escape and keeps the edits', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await startEditing(wrapper)
    await wrapper.get(EDITOR_SELECTOR).setValue(EDITED_DIAGRAM)
    await wrapper.get(EDITOR_SELECTOR).trigger('keydown', { key: 'Escape' })

    expect(wrapper.find(EDITOR_SELECTOR).exists()).toBe(false)
    expect(wrapper.find('[data-testid="mermaid-edited-badge"]').exists())
      .toBe(true)
  })

  it('inserts two spaces on Tab instead of leaving the editor', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await startEditing(wrapper)

    const editor = getEditor(wrapper)

    editor.setSelectionRange(0, 0)
    editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    }))
    await flushPromises()

    expect(editor.value).toBe(`  ${VALID_DIAGRAM}`)
    expect(wrapper.find('[data-testid="mermaid-edit-reset"]').exists())
      .toBe(true)
  })

  it('lets the user fix a block that failed to render', async () => {
    const wrapper = await mountPre(INVALID_DIAGRAM)

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="mermaid-error"]').exists())
        .toBe(true)
    })

    await startEditing(wrapper)

    expect(getEditor(wrapper).value).toBe(INVALID_DIAGRAM)
    expect(wrapper.find('[data-testid="shiki-code"]').exists()).toBe(false)
    expect(wrapper.find(DIAGRAM_SELECTOR).exists()).toBe(true)

    await vi.waitFor(() => {
      expect(wrapper.get(DIAGRAM_SELECTOR).classes())
        .toContain('opacity-60')
    })

    expect(wrapper.find('.skeleton').exists()).toBe(false)

    await typeInEditor(wrapper, EDITED_DIAGRAM)
    await waitForDiagramText(wrapper, 'Begin')

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="mermaid-error"]').exists())
        .toBe(false)
    })

    await wrapper.get('[data-testid="mermaid-edit-done"]').trigger('click')

    expect(wrapper.get(DIAGRAM_SELECTOR).text()).toContain('Begin')
    expect(wrapper.find('[data-testid="mermaid-toggle"]').exists()).toBe(true)
  })

  it('falls back to the code view with the error after Done on an invalid '
    + 'edit', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await startEditing(wrapper)
    await typeInEditor(wrapper, INVALID_EDIT)

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="mermaid-error"]').exists())
        .toBe(true)
    })

    await wrapper.get('[data-testid="mermaid-edit-done"]').trigger('click')

    expect(wrapper.find(EDITOR_SELECTOR).exists()).toBe(false)
    expect(wrapper.get('[data-testid="shiki-code"]').text())
      .toBe(INVALID_EDIT)
    expect(wrapper.get('[data-testid="mermaid-error"]').text())
      .toContain('Couldn\'t render diagram')
    expect(wrapper.get('[data-testid="mermaid-edited-badge"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="mermaid-edit"]').exists()).toBe(true)

    await findButton(wrapper, 'Copy')!.trigger('click')

    expect(mocks.copy).toHaveBeenCalledWith(INVALID_EDIT)
  })

  it('does not misreport a stale error when a fix is committed by Done',
    async () => {
      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)
      await startEditing(wrapper)
      await typeInEditor(wrapper, INVALID_EDIT)

      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="mermaid-error"]').exists())
          .toBe(true)
      })

      await wrapper.get(EDITOR_SELECTOR).setValue(EDITED_DIAGRAM)
      await wrapper.get('[data-testid="mermaid-edit-done"]')
        .trigger('click')
      await waitForDiagramText(wrapper, 'Begin')

      expect(wrapper.find('[data-testid="mermaid-error"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="shiki-code"]').exists()).toBe(false)
    })

  it('replaces unedited source when the code prop changes', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await wrapper.setProps({ code: EDITED_DIAGRAM })
    await waitForDiagramText(wrapper, 'Begin')

    expect(wrapper.find('[data-testid="mermaid-edited-badge"]').exists())
      .toBe(false)
  })

  it('keeps the user edits when the code prop changes afterwards',
    async () => {
      const userEdit = 'flowchart LR\n  X[Mine] --> Y[Edit]'
      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)
      await startEditing(wrapper)
      await typeInEditor(wrapper, userEdit)
      await waitForDiagramText(wrapper, 'Mine')
      await wrapper.get('[data-testid="mermaid-edit-done"]')
        .trigger('click')
      await wrapper.setProps({ code: EDITED_DIAGRAM })
      await flushPromises()

      expect(wrapper.get(DIAGRAM_SELECTOR).text()).toContain('Mine')
      expect(wrapper.find('[data-testid="mermaid-edited-badge"]').exists())
        .toBe(true)

      await wrapper.get('[data-testid="mermaid-toggle"]').trigger('click')

      expect(wrapper.get('[data-testid="shiki-code"]').text()).toBe(userEdit)
    })

  it('returns focus to the Edit button after Done and after Escape',
    async () => {
      const host = document.createElement('div')

      document.body.append(host)

      const wrapper = await mountPre(VALID_DIAGRAM, { attachTo: host })

      try {
        await waitForDiagram(wrapper)

        await startEditing(wrapper)
        await wrapper.get('[data-testid="mermaid-edit-done"]')
          .trigger('click')

        await vi.waitFor(() => {
          expect(document.activeElement)
            .toBe(wrapper.get('[data-testid="mermaid-edit"]').element)
        })

        ;(document.activeElement as HTMLElement).blur()

        await startEditing(wrapper)
        await wrapper.get(EDITOR_SELECTOR)
          .trigger('keydown', { key: 'Escape' })

        await vi.waitFor(() => {
          expect(document.activeElement)
            .toBe(wrapper.get('[data-testid="mermaid-edit"]').element)
        })
      } finally {
        wrapper.unmount()
        host.remove()
      }
    })

  it('resets the edits from the toolbar outside edit mode', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await startEditing(wrapper)
    await typeInEditor(wrapper, EDITED_DIAGRAM)
    await waitForDiagramText(wrapper, 'Begin')
    await wrapper.get('[data-testid="mermaid-edit-done"]').trigger('click')

    await wrapper.get('[data-testid="mermaid-edit-reset"]').trigger('click')
    await waitForDiagramText(wrapper, 'Start')

    expect(wrapper.find('[data-testid="mermaid-edit-reset"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="mermaid-edited-badge"]').exists())
      .toBe(false)
    expect(wrapper.get(DIAGRAM_SELECTOR).text()).not.toContain('Begin')
  })

  it('drops a pending commit when the block unmounts', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await startEditing(wrapper)

    fakeTimeoutTimers()

    try {
      await wrapper.get(EDITOR_SELECTOR).setValue(EDITED_DIAGRAM)

      const vm = wrapper.vm as unknown as {
        editedSource: string | null
      }

      wrapper.unmount()
      await vi.advanceTimersByTimeAsync(COMMIT_DEBOUNCE_MS * 2)

      expect(vm.editedSource).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not commit a pending edit after Reset', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await startEditing(wrapper)

    fakeTimeoutTimers()

    try {
      await wrapper.get(EDITOR_SELECTOR).setValue(EDITED_DIAGRAM)
      await wrapper.get('[data-testid="mermaid-edit-reset"]')
        .trigger('click')
      await vi.advanceTimersByTimeAsync(COMMIT_DEBOUNCE_MS * 2)
    } finally {
      vi.useRealTimers()
    }

    expect(getEditor(wrapper).value).toBe(VALID_DIAGRAM)
    expect(wrapper.find('[data-testid="mermaid-edited-badge"]').exists())
      .toBe(false)
  })

  it('keeps the typed text and edits when the code prop changes while '
    + 'editing', async () => {
    const replacement = 'flowchart LR\n  P[Other] --> Q[Thing]'
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await startEditing(wrapper)
    await typeInEditor(wrapper, EDITED_DIAGRAM)
    await waitForDiagramText(wrapper, 'Begin')
    await wrapper.setProps({ code: replacement })
    await flushPromises()

    expect(getEditor(wrapper).value).toBe(EDITED_DIAGRAM)
    expect(wrapper.get(DIAGRAM_SELECTOR).text()).toContain('Begin')
    expect(wrapper.find('[data-testid="mermaid-edited-badge"]').exists())
      .toBe(true)
  })

  it('follows the code prop in the editor while the text is untouched',
    async () => {
      const replacement = 'flowchart LR\n  P[Other] --> Q[Thing]'
      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)
      await startEditing(wrapper)
      await wrapper.setProps({ code: replacement })
      await waitForDiagramText(wrapper, 'Other')

      expect(getEditor(wrapper).value).toBe(replacement)
      expect(wrapper.find('[data-testid="mermaid-edited-badge"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="mermaid-edit-reset"]').exists())
        .toBe(false)
    })

  it('exports the previous consistent source and svg while a committed '
    + 'edit is still rendering', async () => {
    const actual = await vi.importActual<typeof import('pele/lazy')>(
      'pele/lazy',
    )
    const PENDING_DIAGRAM = 'flowchart LR\n  M[Unique] --> N[Pending]'
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await startEditing(wrapper)

    mocks.renderAsync.mockClear()

    let releaseRender!: () => void

    mocks.renderAsync.mockImplementationOnce(async (source, options) => {
      await new Promise<void>((resolve) => {
        releaseRender = resolve
      })

      return actual.renderAsync(source, options)
    })

    await typeInEditor(wrapper, PENDING_DIAGRAM)
    await vi.waitFor(() => {
      expect(mocks.renderAsync).toHaveBeenCalledTimes(1)
    })

    expect(wrapper.get('[data-testid="mermaid-fullscreen"]').classes())
      .not.toContain('btn-disabled')
    expect(wrapper.get('[data-testid="mermaid-download"]').classes())
      .not.toContain('btn-disabled')

    await wrapper.get('[data-testid="mermaid-export-copy-markdown"]')
      .trigger('click')

    expect(mocks.runExportAction).toHaveBeenLastCalledWith(
      'copy-markdown',
      expect.objectContaining({
        source: VALID_DIAGRAM,
        svg: expect.stringContaining('Start'),
      }),
    )

    releaseRender()
    await waitForDiagramText(wrapper, 'Pending')
    await wrapper.get('[data-testid="mermaid-export-copy-markdown"]')
      .trigger('click')

    expect(mocks.runExportAction).toHaveBeenLastCalledWith(
      'copy-markdown',
      expect.objectContaining({
        source: PENDING_DIAGRAM,
        svg: expect.stringContaining('Pending'),
      }),
    )
  })
})
