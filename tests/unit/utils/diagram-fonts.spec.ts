import { afterEach, describe, expect, it } from 'vitest'
import {
  collectDiagramFontDescriptors,
  getSourceCodePoints,
  isUsedFontWeight,
  parseUnicodeRange,
  rangesCoverCodePoints,
  selectNeededFonts,
} from '~/utils/diagram-fonts'

function createFontFaceRule(properties: Record<string, string>) {
  return {
    type: 5,
    style: {
      getPropertyValue: (name: string) => properties[name] ?? '',
    },
  }
}

function createSheet(rules: unknown[], href: string | null = null) {
  return { href, cssRules: rules } as unknown as CSSStyleSheet
}

describe('utils/diagram-fonts', () => {
  afterEach(() => {
    document.head.querySelectorAll('style').forEach((style) => {
      style.remove()
    })
  })

  it('collects only the diagram font faces with their descriptors', () => {
    const descriptors = collectDiagramFontDescriptors([
      createSheet([
        createFontFaceRule({
          'font-family': '"Nunito"',
          'src': 'url(/_fonts/nunito.woff2) format(\'woff2\')',
          'font-weight': '400',
          'font-style': 'normal',
          'unicode-range': 'U+0000-00FF',
        }),
        createFontFaceRule({
          'font-family': 'Atkinson Hyperlegible Mono',
          'src': 'url("/_fonts/mono.woff2") format("woff2")',
        }),
        createFontFaceRule({
          'font-family': 'Other',
          'src': 'url(/_fonts/other.woff2)',
        }),
        { type: 1, style: { getPropertyValue: () => '' } },
      ]),
    ], 'https://besidka.com/chats/new')

    expect(descriptors).toEqual([
      {
        family: 'Nunito',
        src: 'url("https://besidka.com/_fonts/nunito.woff2") '
          + 'format(\'woff2\')',
        weight: '400',
        style: 'normal',
        unicodeRange: 'U+0000-00FF',
      },
      {
        family: 'Atkinson Hyperlegible Mono',
        src: 'url("https://besidka.com/_fonts/mono.woff2") format("woff2")',
        weight: undefined,
        style: undefined,
        unicodeRange: undefined,
      },
    ])
  })

  it('resolves relative urls against the stylesheet href', () => {
    const [descriptor] = collectDiagramFontDescriptors([
      createSheet([
        createFontFaceRule({
          'font-family': 'Nunito',
          'src': 'url(../fonts/nunito.woff2) format("woff2"), local(Nunito)',
        }),
      ], 'https://besidka.com/_nuxt/css/entry.css'),
    ], 'https://besidka.com/chats/new')

    expect(descriptor?.src).toBe(
      'url("https://besidka.com/_nuxt/fonts/nunito.woff2") format("woff2"), '
      + 'local(Nunito)',
    )
  })

  it('keeps data urls untouched', () => {
    const src = 'url(data:font/woff2;base64,AAAA) format("woff2")'
    const [descriptor] = collectDiagramFontDescriptors([
      createSheet([
        createFontFaceRule({ 'font-family': 'Nunito', src }),
      ]),
    ], 'https://besidka.com/')

    expect(descriptor?.src).toBe(src)
  })

  it('skips stylesheets whose rules cannot be read', () => {
    const blockedSheet = {
      href: 'https://cdn.example.com/fonts.css',
      get cssRules(): CSSRuleList {
        throw new DOMException('Blocked', 'SecurityError')
      },
    } as unknown as CSSStyleSheet

    const descriptors = collectDiagramFontDescriptors([
      blockedSheet,
      createSheet([
        createFontFaceRule({
          'font-family': 'Nunito',
          'src': 'url(/_fonts/nunito.woff2)',
        }),
      ]),
    ], 'https://besidka.com/')

    expect(descriptors).toHaveLength(1)
  })

  it('returns an empty list when no diagram font is declared', () => {
    expect(collectDiagramFontDescriptors([], 'https://besidka.com/'))
      .toEqual([])
  })

  it('reads font faces from real document stylesheets', () => {
    const style = document.createElement('style')

    style.textContent = '@font-face { font-family: "Nunito"; '
      + 'src: url("/_fonts/real.woff2") format("woff2"); '
      + 'font-weight: 700; unicode-range: U+0000-00FF; }'
    document.head.appendChild(style)

    const descriptors = collectDiagramFontDescriptors(
      document.styleSheets,
      'https://besidka.com/chats/new',
    )

    expect(descriptors).toEqual([
      {
        family: 'Nunito',
        src: 'url("https://besidka.com/_fonts/real.woff2") format("woff2")',
        weight: '700',
        style: undefined,
        unicodeRange: 'U+0000-00FF',
      },
    ])
  })

  describe('parseUnicodeRange', () => {
    it('parses single, span and wildcard tokens', () => {
      expect(parseUnicodeRange('U+0041, U+0400-04FF, U+26??, u+1f600'))
        .toEqual([
          { start: 0x41, end: 0x41 },
          { start: 0x400, end: 0x4FF },
          { start: 0x2600, end: 0x26FF },
          { start: 0x1F600, end: 0x1F600 },
        ])
    })

    it('treats a missing or invalid descriptor as covering everything', () => {
      expect(parseUnicodeRange(undefined)).toBeNull()
      expect(parseUnicodeRange('')).toBeNull()
      expect(parseUnicodeRange('nonsense, U+ZZ')).toBeNull()
    })

    it('ignores invalid tokens next to valid ones', () => {
      expect(parseUnicodeRange('bad, U+0041-0030, U+0042')).toEqual([
        { start: 0x42, end: 0x42 },
      ])
    })
  })

  describe('rangesCoverCodePoints', () => {
    it('matches any code point inside any range', () => {
      const ranges = parseUnicodeRange('U+0400-04FF, U+2000-206F')

      expect(rangesCoverCodePoints(ranges, getSourceCodePoints('A Ж')))
        .toBe(true)
      expect(rangesCoverCodePoints(ranges, getSourceCodePoints('abc')))
        .toBe(false)
      expect(rangesCoverCodePoints(ranges, getSourceCodePoints('a\u2014')))
        .toBe(true)
    })

    it('always matches when the face has no range', () => {
      expect(rangesCoverCodePoints(null, [])).toBe(true)
    })

    it('reads astral characters as one code point', () => {
      const ranges = parseUnicodeRange('U+1F600-1F64F')

      expect(rangesCoverCodePoints(ranges, getSourceCodePoints('\u{1F600}')))
        .toBe(true)
    })
  })

  describe('isUsedFontWeight', () => {
    it('accepts the weights Pele measures and rejects the rest', () => {
      expect(isUsedFontWeight('400')).toBe(true)
      expect(isUsedFontWeight('700')).toBe(true)
      expect(isUsedFontWeight('normal')).toBe(true)
      expect(isUsedFontWeight(undefined)).toBe(true)
      expect(isUsedFontWeight('bold')).toBe(true)
      expect(isUsedFontWeight('900')).toBe(false)
      expect(isUsedFontWeight('300')).toBe(false)
    })

    it('accepts variable weight spans that include a used weight', () => {
      expect(isUsedFontWeight('200 1000')).toBe(true)
      expect(isUsedFontWeight('800 900')).toBe(false)
    })
  })

  describe('selectNeededFonts', () => {
    const latin = 'U+0000-00FF, U+0131'
    const cyrillic = 'U+0301, U+0400-045F, U+0490-0491'
    const greek = 'U+0370-03FF'

    function createDescriptors() {
      return ['400', '700', '900'].flatMap((weight) => {
        return [latin, cyrillic, greek].map((unicodeRange) => {
          return {
            family: 'Nunito',
            src: `url("/_fonts/${weight}-${unicodeRange}.woff2")`,
            weight,
            unicodeRange,
          }
        })
      })
    }

    it('drops unused weights and ranges the source never touches', () => {
      const selected = selectNeededFonts(
        createDescriptors(),
        'flowchart LR\n  A[Start] --> B',
      )

      expect(selected.map(face => `${face.weight}:${face.unicodeRange}`))
        .toEqual([`400:${latin}`, `700:${latin}`])
    })

    it('adds the faces for scripts present in the source', () => {
      const selected = selectNeededFonts(
        createDescriptors(),
        'flowchart LR\n  A[Старт] --> B',
      )

      expect(selected.map(face => `${face.weight}:${face.unicodeRange}`))
        .toEqual([
          `400:${latin}`,
          `400:${cyrillic}`,
          `700:${latin}`,
          `700:${cyrillic}`,
        ])
    })

    it('keeps faces without a range', () => {
      const selected = selectNeededFonts([
        { family: 'Atkinson Hyperlegible Mono', src: 'url("/mono.woff2")' },
      ], 'x')

      expect(selected).toHaveLength(1)
    })
  })
})
