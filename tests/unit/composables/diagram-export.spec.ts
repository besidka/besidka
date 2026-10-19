import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiagramExportInput } from '~/types/diagram-export.d'
import { useDiagramExport } from '~/composables/diagram-export'
import { decodeBase64Utf8 } from '~/utils/diagram-export-encoding'
import { renderDiagramSvg } from '~/utils/diagram-render-core'
import { svgToPngBlob } from '~/utils/diagram-export-png'

vi.mock('~/utils/diagram-export-fonts', () => ({
  buildEmbeddedFontCss: vi.fn(),
}))

vi.mock('~/utils/diagram-export-png', () => ({
  svgToPngBlob: vi.fn(),
}))

const SOURCE = 'flowchart LR\n  A[Start] --> B{Ok?}'
const THEME: Record<string, string> = {
  '--pele-bg': 'oklch(20% 0 0)',
  '--pele-fg': 'oklch(95% 0 0)',
  '--pele-line': 'oklch(90% 0 0)',
  '--pele-muted': 'color-mix(in oklab, oklch(95% 0 0) 60%, transparent)',
  '--pele-font': '\'Nunito\', sans-serif',
}
const CONVERTED_COLORS: Record<string, number[]> = {
  'oklch(20% 0 0)': [16, 16, 16, 255],
  'oklch(95% 0 0)': [238, 238, 238, 255],
  'oklch(90% 0 0)': [221, 221, 221, 255],
  'color-mix(in oklab, oklch(95% 0 0) 60%, transparent)': [238, 238, 238, 153],
  'oklch(100% 0 0)': [255, 255, 255, 255],
  'oklch(0% 0 0 / 50%)': [0, 0, 0, 128],
  'transparent': [0, 0, 0, 0],
}

function createCanvasContext() {
  let fillStyle = '#000000'

  return {
    get fillStyle() {
      return fillStyle
    },
    set fillStyle(value: string) {
      fillStyle = value in CONVERTED_COLORS || value.startsWith('rgb(')
        ? value
        : fillStyle
    },
    clearRect: () => {},
    fillRect: () => {},
    getImageData: () => ({
      data: CONVERTED_COLORS[fillStyle] ?? [0, 0, 0, 255],
    }),
  }
}

let themeOverrides: Record<string, string> = {}

function stubComputedStyle() {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((
    element: Element,
  ) => {
    const definitions = new Map<string, string>()

    for (const declaration of (element.getAttribute('style') ?? '').split(';')) {
      const separator = declaration.indexOf(':')

      definitions.set(
        declaration.slice(0, separator).trim(),
        declaration.slice(separator + 1).trim(),
      )
    }

    return {
      getPropertyValue(name: string): string {
        if (name in themeOverrides) {
          return themeOverrides[name] ?? ''
        }

        if (name in THEME) {
          return THEME[name] ?? ''
        }

        const definition = definitions.get(name) ?? ''
        const match = /^var\((--[\w-]+),?\s*(.*)\)$/.exec(definition)

        if (!match) {
          return definition
        }

        return themeOverrides[match[1] ?? '']
          ?? THEME[match[1] ?? '']
          ?? match[2]
          ?? ''
      },
    }
  }) as typeof window.getComputedStyle)
}

class FakeClipboardItem {
  static supports = vi.fn()
  static events: string[] = []

  constructor(public items: Record<string, Promise<Blob>>) {
    FakeClipboardItem.events.push('item')
  }
}

describe('composables/diagram-export', () => {
  let input: DiagramExportInput
  let events: string[]
  let written: FakeClipboardItem[]
  let writeText: ReturnType<typeof vi.fn>
  let write: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    themeOverrides = {}
    events = []
    written = []
    FakeClipboardItem.events = events
    FakeClipboardItem.supports.mockReturnValue(false)
    write = vi.fn(async (items: FakeClipboardItem[]) => {
      events.push('write')
      written.push(...items)

      await Promise.all(items.flatMap(item => Object.values(item.items)))
    })
    writeText = vi.fn(async () => {})

    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { write, writeText },
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (() => createCanvasContext()) as unknown as HTMLCanvasElement['getContext'],
    )
    stubComputedStyle()

    const { buildEmbeddedFontCss } = await import('~/utils/diagram-export-fonts')

    vi.mocked(buildEmbeddedFontCss).mockResolvedValue('')
    vi.mocked(svgToPngBlob).mockResolvedValue(
      new Blob(['png'], { type: 'image/png' }),
    )

    const themeElement = document.createElement('div')

    themeElement.className = 'pele-theme'
    document.body.appendChild(themeElement)

    input = {
      source: SOURCE,
      svg: await renderDiagramSvg(SOURCE, undefined),
      themeElement,
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('data-theme')
  })

  async function readBlobText(blob: Blob): Promise<string> {
    return blob.text()
  }

  describe('buildStandaloneSvg', () => {
    it('flattens variables into hex literals with size and background', async () => {
      const { buildStandaloneSvg } = useDiagramExport()
      const svg = await buildStandaloneSvg(input)
      const root = new DOMParser()
        .parseFromString(svg, 'image/svg+xml').documentElement
      const background = root.firstElementChild

      expect(svg).not.toContain('var(')
      expect(svg).toContain('#eeeeee')
      expect(svg).toContain('#dddddd')
      expect(root.getAttribute('width')).toBeTruthy()
      expect(root.getAttribute('height')).toBeTruthy()
      expect(background?.localName).toBe('rect')
      expect(background?.getAttribute('fill')).toBe('#101010')
      expect(root.getAttribute('style')).toContain('font-family:')
    })

    async function readBackgroundFill(): Promise<string | null> {
      const svg = await useDiagramExport().buildStandaloneSvg(input)
      const root = new DOMParser()
        .parseFromString(svg, 'image/svg+xml').documentElement

      return root.firstElementChild?.getAttribute('fill') ?? null
    }

    it('keeps an opaque white light background as an opaque white rect', async () => {
      themeOverrides = {
        '--pele-bg': 'oklch(100% 0 0)',
        '--color-base-100': 'oklch(100% 0 0)',
      }

      expect(await readBackgroundFill()).toBe('#ffffff')
    })

    it('composites a translucent background over the page background', async () => {
      themeOverrides = {
        '--pele-bg': 'oklch(0% 0 0 / 50%)',
        '--color-base-100': 'oklch(100% 0 0)',
      }

      expect(await readBackgroundFill()).toBe('#7f7f7f')
    })

    it('replaces a fully transparent background with the page background', async () => {
      themeOverrides = {
        '--pele-bg': 'transparent',
        '--color-base-100': 'oklch(100% 0 0)',
      }

      expect(await readBackgroundFill()).toBe('#ffffff')
    })

    it('falls back to white in the light theme when nothing resolves', async () => {
      themeOverrides = { '--pele-bg': '', '--_bg': '' }
      document.documentElement.setAttribute('data-theme', 'light')

      expect(await readBackgroundFill()).toBe('#ffffff')
    })

    it('falls back to the dark base in the dark theme when nothing resolves', async () => {
      themeOverrides = { '--pele-bg': '', '--_bg': '' }
      document.documentElement.setAttribute('data-theme', 'dark')

      expect(await readBackgroundFill()).toBe('#292524')
    })

    it('removes the off-screen mount from the theme element', async () => {
      const { buildStandaloneSvg } = useDiagramExport()

      await buildStandaloneSvg(input)

      expect(input.themeElement.children).toHaveLength(0)
    })

    it('embeds the font-face css returned by the font loader', async () => {
      const { buildEmbeddedFontCss } = await import(
        '~/utils/diagram-export-fonts'
      )

      vi.mocked(buildEmbeddedFontCss).mockResolvedValue(
        '@font-face{font-family:\'Nunito\';}',
      )

      const svg = await useDiagramExport().buildStandaloneSvg(input)

      expect(svg).toContain('<defs><style>@font-face')
    })

    it('rejects when the pristine svg is invalid', async () => {
      await expect(useDiagramExport().buildStandaloneSvg({
        ...input,
        svg: '<svg><g></svg>',
      })).rejects.toThrow()
    })
  })

  describe('runExportAction clipboard', () => {
    it('builds the ClipboardItem and starts the write before any await', () => {
      const result = useDiagramExport().runExportAction('copy-svg', input)

      expect(events).toEqual(['item', 'write'])
      expect(result).toBeInstanceOf(Promise)
    })

    it('copies the svg markup as text/plain only without svg support', async () => {
      const result = await useDiagramExport().runExportAction('copy-svg', input)
      const items = written[0]?.items ?? {}

      expect(result).toBe(true)
      expect(Object.keys(items)).toEqual(['text/plain'])
      expect(await readBlobText(await items['text/plain']!)).toContain('<svg')
    })

    it('adds image/svg+xml when the browser supports it', async () => {
      FakeClipboardItem.supports.mockImplementation((type: string) => {
        return type === 'image/svg+xml'
      })

      await useDiagramExport().runExportAction('copy-svg', input)

      const items = written[0]?.items ?? {}
      const svgBlob = await items['image/svg+xml']!

      expect(Object.keys(items)).toEqual(['text/plain', 'image/svg+xml'])
      expect(svgBlob.type).toBe('image/svg+xml')
    })

    it('copies the raw source as text/plain', async () => {
      const result = await useDiagramExport()
        .runExportAction('copy-source', input)
      const blob = await written[0]!.items['text/plain']!

      expect(result).toBe(true)
      expect(Object.keys(written[0]!.items)).toEqual(['text/plain'])
      expect(await readBlobText(blob)).toBe(SOURCE)
    })

    it('builds the copy-source ClipboardItem before any await', () => {
      const result = useDiagramExport().runExportAction('copy-source', input)

      expect(events).toEqual(['item', 'write'])
      expect(result).toBeInstanceOf(Promise)
    })

    it('copies markdown as text/plain', async () => {
      const result = await useDiagramExport()
        .runExportAction('copy-markdown', input)
      const blob = await written[0]!.items['text/plain']!

      expect(result).toBe(true)
      expect(await readBlobText(blob)).toBe(`\`\`\`mermaid\n${SOURCE}\n\`\`\`\n`)
    })

    it('copies draw.io xml as text/plain with the mermaid source', async () => {
      const result = await useDiagramExport()
        .runExportAction('copy-drawio', input)
      const xml = await readBlobText(await written[0]!.items['text/plain']!)
      const document = new DOMParser().parseFromString(xml, 'application/xml')
      const cell = document.getElementsByTagName('UserObject')[0]
      const style = document
        .getElementsByTagName('mxCell')[2]?.getAttribute('style') ?? ''
      const encodedSvg = /image=data:image\/svg\+xml,([^;]+);/.exec(style)?.[1]

      expect(result).toBe(true)
      expect(document.documentElement.tagName).toBe('mxGraphModel')
      expect(JSON.parse(cell?.getAttribute('mermaidData') ?? '').data)
        .toBe(SOURCE)
      expect(decodeBase64Utf8(encodedSvg ?? '')).toContain('<svg')
    })

    it('falls back to writeText when ClipboardItem is unavailable', async () => {
      vi.stubGlobal('ClipboardItem', undefined)

      const result = await useDiagramExport()
        .runExportAction('copy-svg', input)

      expect(result).toBe(true)
      expect(write).not.toHaveBeenCalled()
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('<svg'))
    })

    it('falls back to writeText when clipboard.write is unavailable', async () => {
      vi.stubGlobal('navigator', { clipboard: { writeText } })

      const result = await useDiagramExport()
        .runExportAction('copy-markdown', input)

      expect(result).toBe(true)
      expect(writeText).toHaveBeenCalledWith(
        `\`\`\`mermaid\n${SOURCE}\n\`\`\`\n`,
      )
    })

    it('retries with writeText when clipboard.write rejects', async () => {
      write.mockRejectedValue(new Error('NotAllowedError'))

      const result = await useDiagramExport()
        .runExportAction('copy-markdown', input)

      expect(result).toBe(true)
      expect(writeText).toHaveBeenCalledTimes(1)
    })

    it('resolves false when every clipboard path fails', async () => {
      write.mockRejectedValue(new Error('NotAllowedError'))
      writeText.mockRejectedValue(new Error('NotAllowedError'))

      await expect(useDiagramExport().runExportAction('copy-markdown', input))
        .resolves.toBe(false)
    })

    it('resolves false when the svg cannot be built', async () => {
      await expect(useDiagramExport().runExportAction('copy-svg', {
        ...input,
        svg: '<svg><g></svg>',
      })).resolves.toBe(false)
    })
  })

  describe('runExportAction downloads and draw.io', () => {
    let anchors: HTMLAnchorElement[]
    let blobs: Blob[]

    beforeEach(() => {
      anchors = []
      blobs = []
      vi.useFakeTimers()
      vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        blobs.push(blob as Blob)

        return 'blob:download'
      })
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
        function (this: HTMLAnchorElement) {
          anchors.push(this)
        },
      )
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it.each([
      ['download-svg', 'diagram.svg', 'image/svg+xml;charset=utf-8'],
      ['download-drawio', 'diagram.drawio', 'application/vnd.jgraph.mxfile'],
      ['download-png', 'diagram.png', 'image/png'],
    ] as const)('%s clicks an <a download> and revokes later', async (
      action,
      fileName,
      mimeType,
    ) => {
      const result = await useDiagramExport().runExportAction(action, input)

      expect(result).toBe(true)
      expect(anchors[0]?.download).toBe(fileName)
      expect(anchors[0]?.getAttribute('href')).toBe('blob:download')
      expect(blobs[0]?.type).toBe(mimeType)
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()

      vi.runAllTimers()

      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:download')
    })

    it('download-drawio writes an mxfile', async () => {
      await useDiagramExport().runExportAction('download-drawio', input)

      expect(await readBlobText(blobs[0]!)).toMatch(/^<mxfile host="besidka">/)
    })

    it('resolves false when a download fails', async () => {
      vi.mocked(svgToPngBlob).mockRejectedValue(new Error('too large'))

      await expect(useDiagramExport().runExportAction('download-png', input))
        .resolves.toBe(false)
      expect(anchors).toHaveLength(0)
    })
  })

  describe('exposed helpers', () => {
    it('exposes the markdown builder', () => {
      expect(useDiagramExport().buildMarkdown('graph TD')).toBe(
        '```mermaid\ngraph TD\n```\n',
      )
    })
  })
})
