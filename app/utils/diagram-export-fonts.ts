import type { DiagramEmbeddedFontFace } from '~/types/diagram-export.d'
import type { DiagramFontDescriptor } from '~/types/diagram.d'
import {
  collectDiagramFontDescriptors,
  isUsedFontWeight,
  parseUnicodeRange,
  rangesCoverCodePoints,
} from '~/utils/diagram-fonts'
import {
  DIAGRAM_FONT_MONO_NAME,
  DIAGRAM_FONT_NAME,
} from '~/utils/diagram-render-core'
import { encodeBytesToBase64 } from '~/utils/diagram-export-encoding'
import { svgUsesFontFamily } from '~/utils/diagram-export-svg'

const LATIN_PROBE_CODE_POINT: number = 0x41
const EMBEDDED_FAMILIES: string[] = [
  DIAGRAM_FONT_NAME,
  DIAGRAM_FONT_MONO_NAME,
]
const SOURCE_ENTRY_PATTERN: RegExp
  = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)(?:\s*format\(\s*["']?([\w-]+)["']?\s*\))?/g
const FONT_MIME_TYPES: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  truetype: 'font/ttf',
  ttf: 'font/ttf',
  opentype: 'font/otf',
  otf: 'font/otf',
}
const FORMAT_PREFERENCE: string[] = ['woff2', 'woff', 'truetype', 'opentype']
const DATA_URL_PATTERN: RegExp = /^data:/i

const encodedFontCache = new Map<string, Promise<string | null>>()

interface FontSource {
  url: string
  format: string
}

function pickFontSource(src: string): FontSource | null {
  const sources: FontSource[] = []

  for (const match of src.matchAll(SOURCE_ENTRY_PATTERN)) {
    const url = match[1] ?? match[2] ?? match[3]

    if (!url) {
      continue
    }

    const extension = /\.(woff2|woff|ttf|otf)(?:[?#].*)?$/i
      .exec(url)?.[1]
      ?.toLowerCase()

    sources.push({
      url,
      format: (match[4] ?? extension ?? 'woff2').toLowerCase(),
    })
  }

  for (const format of FORMAT_PREFERENCE) {
    const source = sources.find(candidate => candidate.format === format)

    if (source) {
      return source
    }
  }

  return sources[0] ?? null
}

export function selectLatinFontFaces(
  descriptors: DiagramFontDescriptor[],
  family: string,
): DiagramFontDescriptor[] {
  const seenSources = new Set<string>()

  return descriptors.filter((descriptor) => {
    if (descriptor.family !== family || !isUsedFontWeight(descriptor.weight)) {
      return false
    }

    const ranges = parseUnicodeRange(descriptor.unicodeRange)

    if (!rangesCoverCodePoints(ranges, [LATIN_PROBE_CODE_POINT])) {
      return false
    }

    const key = `${descriptor.weight ?? ''}|${descriptor.src}`

    if (seenSources.has(key)) {
      return false
    }

    seenSources.add(key)

    return true
  })
}

/**
 * Font sources come from page stylesheets, which may be third-party; only
 * `data:` and same-origin URLs are fetched so an export never makes a
 * cross-origin request.
 */
export function isAllowedFontUrl(
  url: string,
  baseHref: string = window.location.href,
): boolean {
  if (DATA_URL_PATTERN.test(url.trim())) {
    return true
  }

  try {
    return new URL(url, baseHref).origin === new URL(baseHref).origin
  } catch {
    return false
  }
}

async function fetchFontAsDataUrl(
  url: string,
  format: string,
): Promise<string | null> {
  if (!isAllowedFontUrl(url)) {
    return null
  }

  try {
    const response = await fetch(url)

    if (!response.ok || !isAllowedFontUrl(response.url || url)) {
      return null
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    const mimeType = FONT_MIME_TYPES[format] ?? 'font/woff2'

    return `data:${mimeType};base64,${encodeBytesToBase64(bytes)}`
  } catch {
    return null
  }
}

export function loadEncodedFont(
  url: string,
  format: string,
): Promise<string | null> {
  const cached = encodedFontCache.get(url)

  if (cached) {
    return cached
  }

  const pending = fetchFontAsDataUrl(url, format).then((dataUrl) => {
    if (dataUrl === null) {
      encodedFontCache.delete(url)
    }

    return dataUrl
  })

  encodedFontCache.set(url, pending)

  return pending
}

export function clearEncodedFontCache(): void {
  encodedFontCache.clear()
}

export async function loadEmbeddedFontFaces(
  descriptors: DiagramFontDescriptor[],
  markup: string,
): Promise<DiagramEmbeddedFontFace[]> {
  const faces: DiagramEmbeddedFontFace[] = []

  for (const family of EMBEDDED_FAMILIES) {
    if (!svgUsesFontFamily(markup, family)) {
      continue
    }

    for (const descriptor of selectLatinFontFaces(descriptors, family)) {
      const source = pickFontSource(descriptor.src)

      if (!source) {
        continue
      }

      const dataUrl = await loadEncodedFont(source.url, source.format)

      if (dataUrl !== null) {
        faces.push({
          family,
          weight: descriptor.weight ?? 'normal',
          dataUrl,
          format: source.format === 'ttf' ? 'truetype' : source.format,
        })
      }
    }
  }

  return faces
}

export function buildFontFaceCss(faces: DiagramEmbeddedFontFace[]): string {
  return faces.map((face) => {
    return `@font-face{font-family:'${face.family}';font-style:normal;`
      + `font-weight:${face.weight};`
      + `src:url(${face.dataUrl}) format('${face.format}');}`
  }).join('')
}

export async function buildEmbeddedFontCss(
  markup: string,
  styleSheets: ArrayLike<CSSStyleSheet>,
  baseHref: string,
): Promise<string> {
  try {
    const descriptors = collectDiagramFontDescriptors(styleSheets, baseHref)
    const faces = await loadEmbeddedFontFaces(descriptors, markup)

    return buildFontFaceCss(faces)
  } catch {
    return ''
  }
}
