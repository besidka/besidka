import { describe, expect, it } from 'vitest'
import {
  cleanRootStyle,
  collectCssVariableNames,
  collectSvgVariableNames,
  finalizeStandaloneSvg,
  flattenCssVariables,
  flattenSvgVariables,
  parseSvgDocument,
  readSvgDimensions,
  svgUsesFontFamily,
} from '~/utils/diagram-export-svg'
import { renderDiagramSvg } from '~/utils/diagram-render-core'

const CYNEFIN_SOURCE = `cynefin-beta
  title Strategy Categorization

  complex
    "Market research"

  complicated
    "Competitive analysis"

  clear
    "Standard pricing"

  chaotic
    "Crisis management"

  complex --> complicated : "Pattern identified"
  complicated --> clear : "Best practice codified"
  clear --> chaotic : "Complacency"
  chaotic --> complex : "Stabilized"
`
const FLOWCHART_SOURCE = 'flowchart LR\n  A[Start] --> B{Ok?}\n  B -->|yes| C[Done]'
const THEME: Record<string, string> = {
  '--pele-bg': '#101010',
  '--pele-fg': '#eeeeee',
  '--pele-muted': '#eeeeee99',
  '--pele-line': '#dddddd',
  '--pele-surface': '#202020',
  '--pele-surface-alt': '#303030',
  '--pele-border': '#555555',
  '--pele-accent': '#ff8800',
  '--pele-series-1': '#ff8800',
  '--pele-series-2': '#0088ff',
  '--pele-series-3': '#00cc66',
  '--pele-series-4': '#ffcc00',
  '--pele-series-5': '#ff0044',
  '--pele-font': '\'Nunito\', sans-serif',
  '--pele-font-mono': '\'Atkinson Hyperlegible Mono\', monospace',
}

function createCascadeResolver(root: Element) {
  const definitions = new Map<string, string>()
  const style = root.getAttribute('style') ?? ''

  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':')
    const property = declaration.slice(0, separator).trim()

    if (property.startsWith('--_')) {
      definitions.set(property, declaration.slice(separator + 1))
    }
  }

  function resolve(name: string): string | undefined {
    const themed = THEME[name]

    if (themed !== undefined) {
      return themed
    }

    const definition = definitions.get(name)

    return definition === undefined
      ? undefined
      : flattenCssVariables(definition, resolve)
  }

  return resolve
}

async function buildFlattenedSvg(source: string): Promise<SVGSVGElement> {
  const root = parseSvgDocument(await renderDiagramSvg(source, undefined))

  flattenSvgVariables(root, createCascadeResolver(root))

  return root
}

describe('utils/diagram-export-svg', () => {
  describe('flattenCssVariables', () => {
    it('replaces a plain reference with its resolved literal', () => {
      expect(flattenCssVariables('var(--a)', name => (
        name === '--a' ? '#fff' : undefined
      ))).toBe('#fff')
    })

    it('uses the fallback, with commas and quotes, when unresolved', () => {
      expect(flattenCssVariables(
        'font-family:var(--font,\'Nunito\', sans-serif);color:red',
        () => undefined,
      )).toBe('font-family:\'Nunito\', sans-serif;color:red')
    })

    it('flattens nested references inside fallbacks', () => {
      const resolve = (name: string) => name === '--b' ? '#abc' : undefined

      expect(flattenCssVariables('var(--a, var(--b, #000))', resolve))
        .toBe('#abc')
      expect(flattenCssVariables('var(--a, var(--c, #000))', resolve))
        .toBe('#000')
    })

    it('replaces several references and keeps surrounding text', () => {
      expect(flattenCssVariables(
        'a:var(--x);b:var(--y,2px);c:calc(var(--x) + 1px)',
        name => name === '--x' ? '4px' : undefined,
      )).toBe('a:4px;b:2px;c:calc(4px + 1px)')
    })

    it('resolves an unresolvable reference without fallback to nothing', () => {
      expect(flattenCssVariables('x var(--missing) y', () => undefined))
        .toBe('x  y')
    })

    it('leaves text without references untouched', () => {
      expect(flattenCssVariables('fill:#fff', () => undefined))
        .toBe('fill:#fff')
    })
  })

  describe('collectCssVariableNames', () => {
    it('collects names including those inside fallbacks', () => {
      expect(collectCssVariableNames('var(--a, var(--b, #000)) var(--c)'))
        .toEqual(['--a', '--b', '--c'])
    })
  })

  describe('real Pele output', () => {
    it.each([
      ['cynefin', CYNEFIN_SOURCE],
      ['flowchart', FLOWCHART_SOURCE],
    ])('flattens every var() of a %s diagram', async (_name, source) => {
      const pristine = parseSvgDocument(
        await renderDiagramSvg(source, undefined),
      )

      expect(collectSvgVariableNames(pristine)).toContain('--pele-bg')
      expect(collectSvgVariableNames(pristine).some((name) => {
        return name.startsWith('--_')
      })).toBe(true)

      const flattened = await buildFlattenedSvg(source)
      const markup = new XMLSerializer().serializeToString(flattened)

      expect(markup).not.toContain('var(')
    })

    it('produces a standalone svg with size, background and namespaces', async () => {
      const flattened = await buildFlattenedSvg(CYNEFIN_SOURCE)
      const standalone = finalizeStandaloneSvg(
        new XMLSerializer().serializeToString(flattened),
        { background: '#101010', fontFaceCss: '' },
      )
      const document = parseSvgDocument(standalone)
      const viewBox = (document.getAttribute('viewBox') ?? '').split(' ')
      const background = document.firstElementChild

      expect(standalone).not.toContain('var(')
      expect(document.getAttribute('width')).toBe(viewBox[2])
      expect(document.getAttribute('height')).toBe(viewBox[3])
      expect(document.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg')
      expect(standalone).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"')
      expect(background?.localName).toBe('rect')
      expect(background?.getAttribute('fill')).toBe('#101010')
      expect(background?.getAttribute('width')).toBe(viewBox[2])
      expect(background?.getAttribute('height')).toBe(viewBox[3])
      expect(document.getAttribute('style')).not.toContain('--')
      expect(document.getAttribute('style')).not.toContain('max-width')
      expect(document.getAttribute('style')).toContain('font-family:')
      expect(standalone).toContain('#ff8800')
    })

    it('bakes the themed font into the root font-family', async () => {
      const flattened = await buildFlattenedSvg(FLOWCHART_SOURCE)

      expect(flattened.getAttribute('style'))
        .toContain('font-family:\'Nunito\', sans-serif')
    })
  })

  describe('finalizeStandaloneSvg', () => {
    const MARKUP = '<svg xmlns="http://www.w3.org/2000/svg"'
      + ' viewBox="10 20 300 150"'
      + ' style="max-width:100%;--_bg:#fff;height:auto;color:#111">'
      + '<g/></svg>'

    it('sets width and height from the viewBox', () => {
      const result = parseSvgDocument(finalizeStandaloneSvg(MARKUP, {
        background: '#fff',
        fontFaceCss: '',
      }))

      expect(result.getAttribute('width')).toBe('300')
      expect(result.getAttribute('height')).toBe('150')
    })

    it('covers the viewBox origin with the background rect as first child', () => {
      const rect = parseSvgDocument(finalizeStandaloneSvg(MARKUP, {
        background: '#123456',
        fontFaceCss: '',
      })).firstElementChild

      expect(rect?.localName).toBe('rect')
      expect(rect?.getAttribute('x')).toBe('10')
      expect(rect?.getAttribute('y')).toBe('20')
      expect(rect?.getAttribute('fill')).toBe('#123456')
    })

    it('keeps only non-variable, non-fluid root style declarations', () => {
      const result = parseSvgDocument(finalizeStandaloneSvg(MARKUP, {
        background: '#fff',
        fontFaceCss: '',
      }))

      expect(result.getAttribute('style')).toBe('color:#111')
    })

    it('embeds font-face css in defs after the background rect', () => {
      const result = parseSvgDocument(finalizeStandaloneSvg(MARKUP, {
        background: '#fff',
        fontFaceCss: '@font-face{font-family:\'Nunito\';}',
      }))
      const [rect, defs] = Array.from(result.children)

      expect(rect?.localName).toBe('rect')
      expect(defs?.localName).toBe('defs')
      expect(defs?.querySelector('style')?.textContent)
        .toBe('@font-face{font-family:\'Nunito\';}')
    })

    it('adds the xmlns attributes when missing', () => {
      const result = finalizeStandaloneSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" width="5" height="4"/>',
        { background: '#fff', fontFaceCss: '' },
      )

      expect(result).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"')
      expect(result).toContain('viewBox="0 0 5 4"')
    })

    it('rejects markup that is not an svg document', () => {
      expect(() => parseSvgDocument('<svg><g></svg>')).toThrow(/valid XML/)
      expect(() => parseSvgDocument('<div/>')).toThrow(/valid XML/)
    })
  })

  describe('cleanRootStyle', () => {
    it('drops custom properties and fluid sizing but keeps the rest', () => {
      expect(cleanRootStyle(
        'max-width:100%;height:auto;--_a:var(--x,1);font:16px sans-serif;'
        + 'font-family:\'A;B\', serif',
      )).toBe('font:16px sans-serif;font-family:\'A;B\', serif')
    })
  })

  describe('readSvgDimensions', () => {
    it('prefers width and height and falls back to the viewBox', () => {
      expect(readSvgDimensions(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"/>',
      )).toEqual({ width: 40, height: 20 })
      expect(readSvgDimensions(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30"/>',
      )).toEqual({ width: 60, height: 30 })
    })

    it('returns null for unusable input', () => {
      expect(readSvgDimensions('not svg')).toBeNull()
      expect(readSvgDimensions(
        '<svg xmlns="http://www.w3.org/2000/svg"/>',
      )).toBeNull()
    })
  })

  describe('svgUsesFontFamily', () => {
    it('matches the family name case-insensitively', () => {
      expect(svgUsesFontFamily('<svg style="font-family:\'nunito\'"/>', 'Nunito'))
        .toBe(true)
      expect(svgUsesFontFamily('<svg/>', 'Nunito')).toBe(false)
    })
  })
})
