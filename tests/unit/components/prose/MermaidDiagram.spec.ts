import { describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import MermaidDiagram from '../../../../app/components/prose/MermaidDiagram.vue'
import type { DiagramRenderResult } from '../../../../app/types/diagram.d'

const mocks = vi.hoisted(() => {
  return { renderDiagram: vi.fn() }
})

mockNuxtImport('useDiagramRenderer', () => {
  return () => {
    return { renderDiagram: mocks.renderDiagram }
  }
})

function createDeferred() {
  let resolve!: (result: DiagramRenderResult) => void
  const promise = new Promise<DiagramRenderResult>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

describe('prose/MermaidDiagram.vue', () => {
  it('renders the svg and emits rendered', async () => {
    mocks.renderDiagram.mockResolvedValue({ svg: '<svg id="first"></svg>' })

    const wrapper = await mountSuspended(MermaidDiagram, {
      props: { code: 'flowchart LR\n  A --> B' },
    })

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="mermaid-diagram"] svg').exists())
        .toBe(true)
    })

    expect(wrapper.emitted('rendered')).toHaveLength(1)
    expect(wrapper.emitted('error')).toBeUndefined()
    expect(wrapper.find('[data-testid="mermaid-diagram"]').exists()).toBe(true)
    expect(mocks.renderDiagram).toHaveBeenCalledWith(
      'flowchart LR\n  A --> B',
      expect.objectContaining({ idPrefix: expect.stringContaining('mermaid') }),
    )
  })

  it('emits the error payload when rendering fails', async () => {
    const error = { message: 'Bad syntax', line: 2, column: 5 }

    mocks.renderDiagram.mockResolvedValue({ error })

    const wrapper = await mountSuspended(MermaidDiagram, {
      props: { code: 'broken' },
    })

    await vi.waitFor(() => {
      expect(wrapper.emitted('error')).toEqual([[error]])
    })

    expect(wrapper.emitted('rendered')).toBeUndefined()
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('re-renders when the code changes', async () => {
    mocks.renderDiagram
      .mockResolvedValueOnce({ svg: '<svg id="first"></svg>' })
      .mockResolvedValueOnce({ svg: '<svg id="second"></svg>' })

    const wrapper = await mountSuspended(MermaidDiagram, {
      props: { code: 'flowchart LR\n  A --> B' },
    })

    await vi.waitFor(() => {
      expect(wrapper.find('svg#first').exists()).toBe(true)
    })

    await wrapper.setProps({ code: 'flowchart LR\n  A --> C' })

    await vi.waitFor(() => {
      expect(wrapper.find('svg#second').exists()).toBe(true)
    })

    expect(mocks.renderDiagram).toHaveBeenCalledTimes(2)
  })

  it('drops a stale result that resolves after a newer one', async () => {
    const stale = createDeferred()
    const fresh = createDeferred()

    mocks.renderDiagram
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise)

    const wrapper = await mountSuspended(MermaidDiagram, {
      props: { code: 'flowchart LR\n  A --> B' },
    })

    await vi.waitFor(() => {
      expect(mocks.renderDiagram).toHaveBeenCalledTimes(1)
    })

    await wrapper.setProps({ code: 'flowchart LR\n  A --> C' })

    await vi.waitFor(() => {
      expect(mocks.renderDiagram).toHaveBeenCalledTimes(2)
    })

    fresh.resolve({ svg: '<svg id="fresh"></svg>' })
    await flushPromises()
    stale.resolve({ svg: '<svg id="stale"></svg>' })
    await flushPromises()

    expect(wrapper.find('svg#fresh').exists()).toBe(true)
    expect(wrapper.find('svg#stale').exists()).toBe(false)
    expect(wrapper.emitted('rendered')).toHaveLength(1)
  })
})
