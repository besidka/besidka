// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DIAGRAM_COPY_MENU_ITEMS,
  DIAGRAM_DOWNLOAD_MENU_ITEMS,
  DIAGRAM_RENDER_OPTIONS,
  DIAGRAM_SVG_SANITIZE_CONFIG,
  MERMAID_MAX_EDGES,
  MERMAID_MAX_TEXT_SIZE,
} from '@besidka/artifacts-protocol'
import {
  MERMAID_COPY_ACTIONS,
  MERMAID_DOWNLOAD_ACTIONS,
} from '../../../../app/utils/mermaid-menu-actions'
import { DIAGRAM_SVG_SANITIZE_CONFIG as APP_SANITIZE_CONFIG } from '../../../../app/utils/sanitize-diagram-svg'

const peleMock = vi.hoisted(() => {
  return {
    renderAsync: vi.fn(),
    load: vi.fn(),
    detectType: vi.fn(),
  }
})

vi.mock('pele/lazy', () => {
  return {
    renderAsync: peleMock.renderAsync,
    load: peleMock.load,
    detectType: peleMock.detectType,
  }
})

const SOURCE = 'flowchart TD\n  A --> B'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'

describe('chat and artifacts render the same diagram', () => {
  beforeEach(() => {
    peleMock.renderAsync.mockReset()
    peleMock.renderAsync.mockResolvedValue({ svg: SVG })
  })

  it('passes the same Pele options, apart from the id prefix and the width', async () => {
    const { renderDiagramSvg: renderInChat } = await import('../../../../app/utils/diagram-render-core')
    const { renderDiagramSvg: renderInArtifact } = await import('~~/workers/artifacts-runtime/src/render/diagram')

    await renderInChat(SOURCE, 600)
    await renderInArtifact(SOURCE, 600)

    const [chatCall, artifactCall] = peleMock.renderAsync.mock.calls

    expect(chatCall?.[0]).toBe(SOURCE)
    expect(artifactCall?.[0]).toBe(SOURCE)

    const { idPrefix: chatPrefix, ...chatOptions } = chatCall![1]
    const { idPrefix: artifactPrefix, ...artifactOptions } = artifactCall![1]

    expect(chatOptions).toEqual(artifactOptions)
    expect(chatOptions).toEqual({ ...DIAGRAM_RENDER_OPTIONS, maxWidth: 600 })
    expect(chatPrefix).not.toBe(artifactPrefix)
  })

  it('shares the limits, the fonts and the layout switches', () => {
    expect(DIAGRAM_RENDER_OPTIONS).toMatchObject({
      maxEdges: MERMAID_MAX_EDGES,
      limit: MERMAID_MAX_TEXT_SIZE,
      images: false,
      links: false,
      fontFamily: '\'Nunito\', sans-serif',
      directionBreakpoint: 480,
    })
  })

  it('sanitizes with one configuration', () => {
    expect(APP_SANITIZE_CONFIG).toBe(DIAGRAM_SVG_SANITIZE_CONFIG)
  })

  it('offers the same Copy and Download items in the same order', () => {
    expect(MERMAID_COPY_ACTIONS.map((item) => {
      return [item.action, item.label, item.icon]
    })).toEqual(DIAGRAM_COPY_MENU_ITEMS.map((item) => {
      return [item.action, item.label, `lucide:${item.icon}`]
    }))
    expect(MERMAID_DOWNLOAD_ACTIONS.map((item) => {
      return [item.action, item.label, item.icon]
    })).toEqual(DIAGRAM_DOWNLOAD_MENU_ITEMS.map((item) => {
      return [item.action, item.label, `lucide:${item.icon}`]
    }))
    expect(DIAGRAM_COPY_MENU_ITEMS.map(item => item.label))
      .toEqual(['Code', 'Markdown', 'SVG', 'PNG', 'For draw.io'])
  })
})
