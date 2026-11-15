const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'title',
  'desc',
])
const ALLOWED_NAMESPACES: Readonly<Record<string, string>> = {
  'xmlns': 'http://www.w3.org/2000/svg',
  'xmlns:xlink': 'http://www.w3.org/1999/xlink',
}
const BYTE_ORDER_MARK = String.fromCharCode(0xFEFF)
const MAX_ELEMENTS = 2000
const XML_DECLARATION = /^\s*<\?xml\s[^>]*\?>/i
const TAG = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=/>"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g
const ATTRIBUTE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g
const ATTRIBUTE_NAME = /^[A-Za-z_:][\w:.-]*$/
const FORBIDDEN_VALUE = /javascript:|vbscript:|data:|&|<|\\/i
const FORBIDDEN_STYLE = /@import|expression|behavior|-moz-binding/i
const URL_REFERENCE = /url\(\s*([^)]*)\)/gi

function stripByteOrderMark(value: string): string {
  return value.startsWith(BYTE_ORDER_MARK) ? value.slice(1) : value
}

function isLocalReference(reference: string): boolean {
  return /^["']?\s*#/.test(reference)
}

function isSafeAttribute(name: string, value: string): boolean {
  const lowerName = name.toLowerCase()

  if (!ATTRIBUTE_NAME.test(name) || lowerName.startsWith('on')) {
    return false
  }

  if (lowerName.startsWith('xmlns')) {
    return ALLOWED_NAMESPACES[lowerName] === value
  }

  if (lowerName === 'xml:base' || lowerName === 'xml:space') {
    return false
  }

  if (lowerName === 'href' || lowerName === 'xlink:href') {
    return value.startsWith('#') && !FORBIDDEN_VALUE.test(value)
  }

  if (FORBIDDEN_VALUE.test(value)) {
    return false
  }

  if (lowerName === 'style' && FORBIDDEN_STYLE.test(value)) {
    return false
  }

  for (const match of value.matchAll(URL_REFERENCE)) {
    if (!isLocalReference(match[1] ?? '')) {
      return false
    }
  }

  return true
}

function areAttributesSafe(raw: string): boolean {
  for (const match of raw.matchAll(ATTRIBUTE)) {
    const value = match[2] ?? match[3] ?? ''

    if (!isSafeAttribute(match[1] ?? '', value)) {
      return false
    }
  }

  return true
}

/**
 * Whether an SVG may be kept and served as a connector icon. This is an
 * allowlist check that rejects on the first hit and never rewrites: only
 * plain shape, gradient, clip and mask elements pass; any `script`, `style`,
 * `use`, `image`, `foreignObject`, animation or text element, event
 * attribute, external or `data:` reference, entity, comment, DOCTYPE, CDATA or
 * processing instruction fails the whole file. Comments are refused rather
 * than skipped: stripping them first lets `<!--` inside a quoted attribute
 * hide a handler from the checks. The route also serves it with
 * `default-src 'none'; sandbox`, and the client loads it only through
 * `<img>`, where script never runs.
 */
export function isSafeSvgIcon(source: string): boolean {
  const withoutBom = stripByteOrderMark(source)
  const withoutDeclaration = withoutBom.replace(XML_DECLARATION, '')

  if (!/^\s*<svg[\s>]/.test(withoutDeclaration)) {
    return false
  }

  if (/<[!?]/.test(withoutDeclaration)) {
    return false
  }

  let elementCount = 0

  for (const match of withoutDeclaration.matchAll(TAG)) {
    const [, closing = '', name = '', attributes = ''] = match

    elementCount += 1

    if (elementCount > MAX_ELEMENTS || !ALLOWED_ELEMENTS.has(name)) {
      return false
    }

    if (!closing && !areAttributesSafe(attributes)) {
      return false
    }
  }

  return !withoutDeclaration.replace(TAG, '').includes('<')
}
