import { describe, expect, it } from 'vitest'
import {
  createColorConverter,
  formatHexColor,
  parseHexColor,
  toOpaqueColor,
} from '~/utils/diagram-export-color'

interface FakeContext {
  fillStyle: string
  clearRect: () => void
  fillRect: () => void
  getImageData: () => { data: number[] }
}

function createFakeContext(
  colors: Record<string, number[]>,
): CanvasRenderingContext2D {
  let fillStyle = '#000000'
  const context: FakeContext = {
    get fillStyle() {
      return fillStyle
    },
    set fillStyle(value: string) {
      fillStyle = value in colors || value.startsWith('rgb(')
        ? value
        : fillStyle
    },
    clearRect: () => {},
    fillRect: () => {},
    getImageData: () => ({ data: colors[fillStyle] ?? [0, 0, 0, 255] }),
  }

  return context as unknown as CanvasRenderingContext2D
}

describe('utils/diagram-export-color', () => {
  it('formats opaque colors as #rrggbb', () => {
    expect(formatHexColor(255, 0, 16, 255)).toBe('#ff0010')
  })

  it('formats translucent colors as #rrggbbaa', () => {
    expect(formatHexColor(10, 20, 30, 153)).toBe('#0a141e99')
  })

  it('formats fully transparent colors without meaningful channels', () => {
    expect(formatHexColor(77, 88, 99, 0)).toBe('#00000000')
  })

  it('parses #rrggbb as opaque and #rrggbbaa with its alpha', () => {
    expect(parseHexColor('#0a141e'))
      .toEqual({ red: 10, green: 20, blue: 30, alpha: 255 })
    expect(parseHexColor('#0a141e99'))
      .toEqual({ red: 10, green: 20, blue: 30, alpha: 153 })
    expect(parseHexColor('bold')).toBeNull()
    expect(parseHexColor('#fff')).toBeNull()
  })

  it('keeps an opaque color unchanged when flattening', () => {
    expect(toOpaqueColor('#ffffff', '#292524')).toBe('#ffffff')
    expect(toOpaqueColor('#292524', '#ffffff')).toBe('#292524')
  })

  it('composites a translucent color over the backdrop', () => {
    expect(toOpaqueColor('#00000080', '#ffffff')).toBe('#7f7f7f')
    expect(toOpaqueColor('#ffffff80', '#000000')).toBe('#808080')
  })

  it('turns a fully transparent color into the backdrop', () => {
    expect(toOpaqueColor('#00000000', '#292524')).toBe('#292524')
  })

  it('returns null for a missing or non-hex color', () => {
    expect(toOpaqueColor(undefined, '#ffffff')).toBeNull()
    expect(toOpaqueColor('bold', '#ffffff')).toBeNull()
  })

  it('treats an unparsable backdrop as white', () => {
    expect(toOpaqueColor('#00000080', 'not-a-color')).toBe('#7f7f7f')
  })

  it('converts a color the canvas understands to hex', () => {
    const convert = createColorConverter(createFakeContext({
      'oklch(62% 0.2 250)': [30, 120, 220, 255],
      'color-mix(in oklab, red 60%, transparent)': [200, 10, 10, 153],
    }))

    expect(convert('oklch(62% 0.2 250)')).toBe('#1e78dc')
    expect(convert(' color-mix(in oklab, red 60%, transparent) '))
      .toBe('#c80a0a99')
  })

  it('returns null for values that are not colors', () => {
    const convert = createColorConverter(createFakeContext({
      'rgb(9, 9, 9)': [9, 9, 9, 255],
    }))

    expect(convert('bold')).toBeNull()
    expect(convert('4px')).toBeNull()
    expect(convert('\'Nunito\', sans-serif')).toBeNull()
    expect(convert('')).toBeNull()
  })

  it('never converts currentColor', () => {
    const convert = createColorConverter(createFakeContext({
      currentcolor: [1, 1, 1, 255],
      currentColor: [1, 1, 1, 255],
    }))

    expect(convert('currentColor')).toBeNull()
  })

  it('keeps raw values when no canvas context exists', () => {
    expect(createColorConverter(null)('#ff0000')).toBeNull()
  })
})
