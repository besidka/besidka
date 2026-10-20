import { afterEach, describe, expect, it, vi } from 'vitest'
import { createColorConverter } from '~/utils/diagram-export-color'
import { resolveThemeVariables } from '~/utils/diagram-export-theme'

const COLOR_PIXELS: Record<string, number[]> = {
  'oklch(62% 0.2 250)': [30, 120, 220, 255],
  'color-mix(in oklab, red 60%, transparent)': [200, 10, 10, 153],
  'rgb(10, 20, 30)': [10, 20, 30, 255],
}
const COMPUTED_VALUES: Record<string, string> = {
  '--oklch': 'oklch(62% 0.2 250)',
  '--mixed': 'color-mix(in oklab, red 60%, transparent)',
  '--rgb': 'rgb(10, 20, 30)',
  '--weight': 'bold',
  '--radius': '4px',
  '--font': '"Nunito", sans-serif',
  '--padded': '  oklch(62% 0.2 250)  ',
  '--empty': '',
}
const SVG_MARKUP = '<svg xmlns="http://www.w3.org/2000/svg" width="10"'
  + ' height="10"><rect width="10" height="10"/></svg>'

function createCanvasContext(): CanvasRenderingContext2D {
  let fillStyle = '#000000'
  const context = {
    get fillStyle() {
      return fillStyle
    },
    set fillStyle(value: string) {
      fillStyle = value in COLOR_PIXELS || value.startsWith('rgb(')
        ? value
        : fillStyle
    },
    clearRect: () => {},
    fillRect: () => {},
    getImageData: () => ({ data: COLOR_PIXELS[fillStyle] ?? [0, 0, 0, 255] }),
  }

  return context as unknown as CanvasRenderingContext2D
}

function parseRoot(): Element {
  return new DOMParser()
    .parseFromString(SVG_MARKUP, 'image/svg+xml')
    .documentElement
}

describe('utils/diagram-export-theme', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  function stubComputedStyle(onRead?: (element: Element) => void) {
    vi.spyOn(window, 'getComputedStyle').mockImplementation(((
      element: Element,
    ) => {
      onRead?.(element)

      return {
        getPropertyValue: (name: string) => COMPUTED_VALUES[name] ?? '',
      }
    }) as typeof window.getComputedStyle)
  }

  function resolve(names: string[], themeElement?: HTMLElement) {
    const element = themeElement ?? document.createElement('div')

    document.body.appendChild(element)

    return resolveThemeVariables(
      parseRoot(),
      element,
      names,
      createColorConverter(createCanvasContext()),
    )
  }

  it('resolves oklch(), color-mix() and rgb() values to hex', () => {
    stubComputedStyle()

    const resolved = resolve(['--oklch', '--mixed', '--rgb'])

    expect(resolved.get('--oklch')).toBe('#1e78dc')
    expect(resolved.get('--mixed')).toBe('#c80a0a99')
    expect(resolved.get('--rgb')).toBe('#0a141e')
  })

  it('trims computed values before converting them', () => {
    stubComputedStyle()

    expect(resolve(['--padded']).get('--padded')).toBe('#1e78dc')
  })

  it('keeps non-color values as literals', () => {
    stubComputedStyle()

    const resolved = resolve(['--weight', '--radius', '--font'])

    expect(resolved.get('--weight')).toBe('bold')
    expect(resolved.get('--radius')).toBe('4px')
    expect(resolved.get('--font')).toBe('\'Nunito\', sans-serif')
  })

  it('omits names the cascade leaves empty or does not define', () => {
    stubComputedStyle()

    const resolved = resolve(['--empty', '--unknown'])

    expect(resolved.has('--empty')).toBe(false)
    expect(resolved.has('--unknown')).toBe(false)
    expect(resolved.size).toBe(0)
  })

  it('computes styles on a copy mounted inside the theme element', () => {
    const themeElement = document.createElement('div')
    const mountedParents: (Element | null)[] = []

    stubComputedStyle((element) => {
      mountedParents.push(element.parentElement?.parentElement ?? null)
    })

    resolve(['--oklch'], themeElement)

    expect(mountedParents).toEqual([themeElement])
  })

  it('removes the off-screen host once resolved, even when reading throws',
    () => {
      const themeElement = document.createElement('div')

      vi.spyOn(window, 'getComputedStyle').mockImplementation((() => {
        throw new Error('style read failed')
      }) as typeof window.getComputedStyle)

      expect(() => resolve(['--oklch'], themeElement)).toThrow('style read')
      expect(themeElement.children).toHaveLength(0)
    })

  it('leaves the theme element without children after a successful read',
    () => {
      const themeElement = document.createElement('div')

      stubComputedStyle()
      resolve(['--oklch'], themeElement)

      expect(themeElement.children).toHaveLength(0)
    })
})
