import { describe, expect, it } from 'vitest'
import {
  buildDrawioClipboardXml,
  buildDrawioFile,
  buildMermaidMarkdown,
} from '~/utils/diagram-export-drawio'
import {
  decodeBase64Utf8,
  encodeBase64Utf8,
  encodeBytesToBase64,
} from '~/utils/diagram-export-encoding'

const SOURCE = 'flowchart LR\n  A["Café & <b>"] --> B{"x > y"}\n'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5">'
  + '<text>Привіт — "quoted" & more</text></svg>'

function parseXml(xml: string): Document {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')

  expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0)

  return parsed
}

describe('utils/diagram-export-encoding', () => {
  it('round-trips UTF-8 text through base64', () => {
    const text = 'Привіт, 世界 — 🚀'

    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text)
  })

  it('encodes large byte arrays without overflowing the stack', () => {
    const bytes = new Uint8Array(300_000).fill(65)

    expect(atob(encodeBytesToBase64(bytes))).toHaveLength(300_000)
  })
})

describe('utils/diagram-export-drawio', () => {
  it('wraps the source in a mermaid fence', () => {
    expect(buildMermaidMarkdown('graph TD\n  A --> B'))
      .toBe('```mermaid\ngraph TD\n  A --> B\n```\n')
  })

  it('builds clipboard xml with re-editable mermaid data and the svg image', () => {
    const xml = buildDrawioClipboardXml(SOURCE, SVG, 10.4, 5.6)
    const document = parseXml(xml)
    const cells = Array.from(document.getElementsByTagName('mxCell'))
    const userObject = document.getElementsByTagName('UserObject')[0]
    const imageCell = userObject?.getElementsByTagName('mxCell')[0]
    const geometry = imageCell?.getElementsByTagName('mxGeometry')[0]
    const style = imageCell?.getAttribute('style') ?? ''
    const imageData = /image=data:image\/svg\+xml,([^;]+);/.exec(style)?.[1]

    expect(document.documentElement.tagName).toBe('mxGraphModel')
    expect(cells[0]?.getAttribute('id')).toBe('0')
    expect(cells[1]?.getAttribute('parent')).toBe('0')
    expect(userObject?.getAttribute('id')).toBe('2')
    expect(JSON.parse(userObject?.getAttribute('mermaidData') ?? '')).toEqual({
      data: SOURCE,
      config: null,
      version: '12',
    })
    expect(imageCell?.getAttribute('vertex')).toBe('1')
    expect(imageCell?.getAttribute('parent')).toBe('1')
    expect(style).toContain('shape=image;noLabel=1;verticalAlign=top;')
    expect(style).toContain('editIcon=1;groupPadding=10;')
    expect(style).not.toContain(';base64')
    expect(decodeBase64Utf8(imageData ?? '')).toBe(SVG)
    expect(geometry?.getAttribute('width')).toBe('10')
    expect(geometry?.getAttribute('height')).toBe('6')
    expect(geometry?.getAttribute('as')).toBe('geometry')
  })

  it('wraps the model in an uncompressed mxfile', () => {
    const document = parseXml(buildDrawioFile(SOURCE, SVG, 10, 5))
    const diagram = document.getElementsByTagName('diagram')[0]

    expect(document.documentElement.tagName).toBe('mxfile')
    expect(document.documentElement.getAttribute('host')).toBe('besidka')
    expect(diagram?.getAttribute('name')).toBe('Diagram')
    expect(diagram?.getElementsByTagName('mxGraphModel')).toHaveLength(1)
  })
})
