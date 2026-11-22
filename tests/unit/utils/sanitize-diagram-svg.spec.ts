import { beforeEach, describe, expect, it, vi } from 'vitest'

const { purify } = vi.hoisted(() => ({
  purify: {
    isSupported: true,
    sanitize: vi.fn((value: string) => `clean:${value}`),
  },
}))

vi.mock('dompurify', () => ({ default: purify }))

const {
  DIAGRAM_SVG_SANITIZE_CONFIG,
  sanitizeDiagramSvg,
} = await import('~/utils/sanitize-diagram-svg')

beforeEach(() => {
  purify.isSupported = true
  purify.sanitize.mockClear()
})

describe('sanitizeDiagramSvg', () => {
  it('sanitizes with the svg profile and without scripts or foreignObject',
    () => {
      expect(sanitizeDiagramSvg('<svg></svg>')).toBe('clean:<svg></svg>')
      expect(purify.sanitize).toHaveBeenCalledWith(
        '<svg></svg>',
        DIAGRAM_SVG_SANITIZE_CONFIG,
      )
      expect(DIAGRAM_SVG_SANITIZE_CONFIG).toEqual({
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['foreignObject', 'script'],
        ADD_ATTR: ['role'],
      })
    })

  it('returns an empty string for empty input or without a DOM', () => {
    expect(sanitizeDiagramSvg('')).toBe('')

    purify.isSupported = false

    expect(sanitizeDiagramSvg('<svg></svg>')).toBe('')
    expect(purify.sanitize).not.toHaveBeenCalled()
  })
})
