import type {
  DiagramCodePointRange,
  DiagramFontDescriptor,
} from '~/types/diagram.d'
import {
  DIAGRAM_FONT_MONO_NAME,
  DIAGRAM_FONT_NAME,
} from '~/utils/diagram-render-core'

const FONT_FACE_RULE_TYPE: number = 5
const DIAGRAM_FONT_NAMES: string[] = [
  DIAGRAM_FONT_NAME,
  DIAGRAM_FONT_MONO_NAME,
]
const USED_FONT_WEIGHTS: number[] = [400, 700]
const GENERATED_TEXT_RANGE: DiagramCodePointRange = {
  start: 0x20,
  end: 0x7E,
}
const UNICODE_RANGE_TOKEN_PATTERN
  = /^U\+([0-9A-F?]{1,6})(?:-([0-9A-F]{1,6}))?$/i
const URL_TOKEN_PATTERN = /url\(\s*(['"]?)(.*?)\1\s*\)/g

function unquote(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2')
}

function resolveSourceUrls(src: string, baseHref: string): string {
  return src.replace(URL_TOKEN_PATTERN, (token, _quote, url: string) => {
    if (url.startsWith('data:')) {
      return token
    }

    try {
      return `url("${new URL(url, baseHref).href}")`
    } catch {
      return token
    }
  })
}

function readRules(container: CSSStyleSheet | CSSGroupingRule): CSSRule[] {
  try {
    return Array.from(container.cssRules)
  } catch {
    return []
  }
}

function isUprightStyle(style: string | undefined): boolean {
  return !/^(italic|oblique)/i.test(style ?? '')
}

function readOptionalProperty(
  style: CSSStyleDeclaration,
  name: string,
): string | undefined {
  const value = style.getPropertyValue(name).trim()

  return value === '' ? undefined : value
}

function toDescriptor(
  rule: CSSRule,
  baseHref: string,
): DiagramFontDescriptor | null {
  const style = (rule as CSSFontFaceRule).style
  const family = unquote(style.getPropertyValue('font-family'))
  const src = style.getPropertyValue('src').trim()
  const fontStyle = readOptionalProperty(style, 'font-style')

  if (
    !DIAGRAM_FONT_NAMES.includes(family)
    || src === ''
    || !isUprightStyle(fontStyle)
  ) {
    return null
  }

  return {
    family,
    src: resolveSourceUrls(src, baseHref),
    weight: readOptionalProperty(style, 'font-weight'),
    style: fontStyle,
    unicodeRange: readOptionalProperty(style, 'unicode-range'),
  }
}

function collectFromRules(
  container: CSSStyleSheet | CSSGroupingRule,
  baseHref: string,
  descriptors: DiagramFontDescriptor[],
): void {
  for (const rule of readRules(container)) {
    if (rule.type === FONT_FACE_RULE_TYPE) {
      const descriptor = toDescriptor(rule, baseHref)

      if (descriptor) {
        descriptors.push(descriptor)
      }

      continue
    }

    if ('cssRules' in rule) {
      collectFromRules(rule as CSSGroupingRule, baseHref, descriptors)
    }
  }
}

/**
 * Collects the upright `@font-face` rules of the diagram fonts from the
 * page's stylesheets, including rules nested in `@media`, `@supports` and
 * `@layer`, so a worker, which cannot see document fonts, can load them.
 * Relative `url()`s are resolved against the owning stylesheet's href (or
 * `baseHref`) because a worker has a different base URL.
 */
export function collectDiagramFontDescriptors(
  styleSheets: ArrayLike<CSSStyleSheet>,
  baseHref: string,
): DiagramFontDescriptor[] {
  const descriptors: DiagramFontDescriptor[] = []

  for (const styleSheet of Array.from(styleSheets)) {
    collectFromRules(styleSheet, styleSheet.href ?? baseHref, descriptors)
  }

  return descriptors
}

function parseUnicodeRangeToken(token: string): DiagramCodePointRange | null {
  const match = UNICODE_RANGE_TOKEN_PATTERN.exec(token.trim())

  if (!match) {
    return null
  }

  const [, first = '', last] = match

  if (first.includes('?')) {
    return {
      start: Number.parseInt(first.replaceAll('?', '0'), 16),
      end: Number.parseInt(first.replaceAll('?', 'F'), 16),
    }
  }

  const start = Number.parseInt(first, 16)
  const end = last === undefined ? start : Number.parseInt(last, 16)

  return end >= start ? { start, end } : null
}

/**
 * Parses a CSS `unicode-range` descriptor (`U+XXXX`, `U+XXXX-YYYY`,
 * `U+XX??`, comma separated). Returns `null` when the face covers every
 * code point: no descriptor, or one with no valid token.
 */
export function parseUnicodeRange(
  value: string | undefined,
): DiagramCodePointRange[] | null {
  if (!value) {
    return null
  }

  const ranges = value
    .split(',')
    .map(parseUnicodeRangeToken)
    .filter((range): range is DiagramCodePointRange => range !== null)

  return ranges.length > 0 ? ranges : null
}

export function getSourceCodePoints(source: string): Set<number> {
  const codePoints = new Set<number>()

  for (const character of source) {
    codePoints.add(character.codePointAt(0) ?? 0)
  }

  return codePoints
}

export function rangesCoverCodePoints(
  ranges: DiagramCodePointRange[] | null,
  codePoints: Iterable<number>,
): boolean {
  if (ranges === null) {
    return true
  }

  for (const codePoint of codePoints) {
    const isCovered = ranges.some((range) => {
      return codePoint >= range.start && codePoint <= range.end
    })

    if (isCovered) {
      return true
    }
  }

  return false
}

function parseFontWeightBounds(weight: string | undefined): [number, number] {
  const bounds = (weight ?? 'normal')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((token) => {
      if (token === 'normal') {
        return 400
      }

      return token === 'bold' ? 700 : Number.parseFloat(token)
    })
    .filter(bound => Number.isFinite(bound))
  const lowest = bounds[0] ?? 400
  const highest = bounds[1] ?? lowest

  return [Math.min(lowest, highest), Math.max(lowest, highest)]
}

/**
 * Pele measures text only in the normal (400) and bold (700) weights.
 */
export function isUsedFontWeight(weight: string | undefined): boolean {
  const [lowest, highest] = parseFontWeightBounds(weight)

  return USED_FONT_WEIGHTS.some((usedWeight) => {
    return usedWeight >= lowest && usedWeight <= highest
  })
}

function rangesOverlap(
  ranges: DiagramCodePointRange[] | null,
  target: DiagramCodePointRange,
): boolean {
  if (ranges === null) {
    return true
  }

  return ranges.some((range) => {
    return range.start <= target.end && range.end >= target.start
  })
}

/**
 * Keeps only the faces a render can use: a weight Pele measures and a
 * `unicode-range` that covers the source's code points or the printable
 * ASCII Pele generates itself (axis labels, percentages).
 */
export function selectNeededFonts(
  fonts: DiagramFontDescriptor[],
  source: string,
): DiagramFontDescriptor[] {
  const codePoints = getSourceCodePoints(source)

  return fonts.filter((descriptor) => {
    if (!isUsedFontWeight(descriptor.weight)) {
      return false
    }

    const ranges = parseUnicodeRange(descriptor.unicodeRange)

    return rangesCoverCodePoints(ranges, codePoints)
      || rangesOverlap(ranges, GENERATED_TEXT_RANGE)
  })
}
