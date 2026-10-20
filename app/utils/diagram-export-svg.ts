import type {
  DiagramSvgDimensions,
  DiagramVariableResolver,
} from '~/types/diagram-export.d'

const SVG_NAMESPACE: string = 'http://www.w3.org/2000/svg'
const XLINK_NAMESPACE: string = 'http://www.w3.org/1999/xlink'
const XMLNS_NAMESPACE: string = 'http://www.w3.org/2000/xmlns/'
const VARIABLE_NAME_PATTERN: RegExp = /var\(\s*(--[\w-]+)/g
const REMOVED_ROOT_PROPERTIES: string[] = ['max-width', 'height']

interface FinalizeSvgOptions {
  background: string
  fontFaceCss: string
}

interface ParsedViewBox {
  minX: number
  minY: number
  width: number
  height: number
}

export function parseSvgDocument(markup: string): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const root = parsed.documentElement

  if (
    !root
    || parsed.getElementsByTagName('parsererror').length > 0
    || root.localName !== 'svg'
  ) {
    throw new Error('The diagram svg is not valid XML')
  }

  return root as unknown as SVGSVGElement
}

function findClosingParenthesis(text: string, openIndex: number): number {
  let depth = 0
  let quote = ''

  for (let index = openIndex; index < text.length; index++) {
    const character = text.charAt(index)

    if (quote !== '') {
      quote = character === quote ? '' : quote

      continue
    }

    if (character === '"' || character === '\'') {
      quote = character
    } else if (character === '(') {
      depth++
    } else if (character === ')') {
      depth--

      if (depth === 0) {
        return index
      }
    }
  }

  return -1
}

function findTopLevelComma(text: string): number {
  let depth = 0
  let quote = ''

  for (let index = 0; index < text.length; index++) {
    const character = text.charAt(index)

    if (quote !== '') {
      quote = character === quote ? '' : quote

      continue
    }

    if (character === '"' || character === '\'') {
      quote = character
    } else if (character === '(') {
      depth++
    } else if (character === ')') {
      depth--
    } else if (character === ',' && depth === 0) {
      return index
    }
  }

  return -1
}

function resolveVariableReference(
  inner: string,
  resolve: DiagramVariableResolver,
): string {
  const commaIndex = findTopLevelComma(inner)
  const name = (commaIndex === -1 ? inner : inner.slice(0, commaIndex)).trim()
  const resolved = resolve(name)

  if (resolved !== undefined && resolved !== '') {
    return resolved
  }

  if (commaIndex === -1) {
    return ''
  }

  return flattenCssVariables(inner.slice(commaIndex + 1).trim(), resolve)
}

/**
 * Replaces every `var(--name[, fallback])` in a CSS value or style text
 * with the resolver's literal. A name the resolver cannot supply falls back
 * to its own fallback, flattened recursively. Walks balanced parentheses
 * because fallbacks hold commas, quotes and nested `var()` calls.
 */
export function flattenCssVariables(
  text: string,
  resolve: DiagramVariableResolver,
): string {
  let output = ''
  let cursor = 0

  while (cursor < text.length) {
    const start = text.indexOf('var(', cursor)

    if (start === -1) {
      break
    }

    const end = findClosingParenthesis(text, start + 3)

    if (end === -1) {
      break
    }

    output += text.slice(cursor, start)
    output += resolveVariableReference(text.slice(start + 4, end), resolve)
    cursor = end + 1
  }

  return output + text.slice(cursor)
}

export function collectCssVariableNames(text: string): string[] {
  const names = new Set<string>()

  for (const match of text.matchAll(VARIABLE_NAME_PATTERN)) {
    const name = match[1]

    if (name) {
      names.add(name)
    }
  }

  return Array.from(names)
}

export function collectSvgVariableNames(root: Element): string[] {
  const names = new Set<string>()
  const elements = [root, ...Array.from(root.querySelectorAll('*'))]

  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      collectCssVariableNames(attribute.value).forEach(name => names.add(name))
    }

    if (element.localName === 'style') {
      collectCssVariableNames(element.textContent ?? '')
        .forEach(name => names.add(name))
    }
  }

  return Array.from(names)
}

export function flattenSvgVariables(
  root: Element,
  resolve: DiagramVariableResolver,
): void {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))]

  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.value.includes('var(')) {
        element.setAttribute(
          attribute.name,
          flattenCssVariables(attribute.value, resolve),
        )
      }
    }

    if (element.localName === 'style' && element.textContent?.includes('var(')) {
      element.textContent = flattenCssVariables(element.textContent, resolve)
    }
  }
}

function splitDeclarations(style: string): string[] {
  const declarations: string[] = []
  let depth = 0
  let quote = ''
  let current = ''

  for (const character of style) {
    if (quote !== '') {
      quote = character === quote ? '' : quote
    } else if (character === '"' || character === '\'') {
      quote = character
    } else if (character === '(') {
      depth++
    } else if (character === ')') {
      depth--
    } else if (character === ';' && depth === 0) {
      declarations.push(current)
      current = ''

      continue
    }

    current += character
  }

  declarations.push(current)

  return declarations.filter(declaration => declaration.trim() !== '')
}

export function cleanRootStyle(style: string): string {
  return splitDeclarations(style)
    .filter((declaration) => {
      const property = declaration.split(':')[0]?.trim().toLowerCase() ?? ''

      return !property.startsWith('--')
        && !REMOVED_ROOT_PROPERTIES.includes(property)
    })
    .map(declaration => declaration.trim())
    .join(';')
}

function parseViewBox(root: Element): ParsedViewBox | null {
  const values = (root.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const [minX, minY, width, height] = values

  if (
    values.length !== 4
    || values.some(value => !Number.isFinite(value))
    || !width
    || !height
    || width <= 0
    || height <= 0
  ) {
    return null
  }

  return { minX: minX ?? 0, minY: minY ?? 0, width, height }
}

function toPositiveNumber(value: string | null): number | null {
  const parsed = Number.parseFloat(value ?? '')

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function readSvgDimensions(
  markup: string,
): DiagramSvgDimensions | null {
  try {
    const root = parseSvgDocument(markup)
    const viewBox = parseViewBox(root)
    const width = toPositiveNumber(root.getAttribute('width'))
      ?? viewBox?.width
    const height = toPositiveNumber(root.getAttribute('height'))
      ?? viewBox?.height

    return width && height ? { width, height } : null
  } catch {
    return null
  }
}

export function svgUsesFontFamily(markup: string, family: string): boolean {
  return markup.toLowerCase().includes(family.toLowerCase())
}

function createBackgroundRect(
  root: Element,
  viewBox: ParsedViewBox,
  background: string,
): Element {
  const rect = root.ownerDocument.createElementNS(SVG_NAMESPACE, 'rect')

  rect.setAttribute('x', String(viewBox.minX))
  rect.setAttribute('y', String(viewBox.minY))
  rect.setAttribute('width', String(viewBox.width))
  rect.setAttribute('height', String(viewBox.height))
  rect.setAttribute('fill', background)

  return rect
}

function createFontDefs(root: Element, fontFaceCss: string): Element {
  const defs = root.ownerDocument.createElementNS(SVG_NAMESPACE, 'defs')
  const style = root.ownerDocument.createElementNS(SVG_NAMESPACE, 'style')

  style.textContent = fontFaceCss
  defs.appendChild(style)

  return defs
}

/**
 * Turns an already variable-free svg into a standalone document: explicit
 * `width`/`height` from the viewBox (Safari rasterizes viewBox-only svgs
 * wrong), a background rect, namespaces, and optional embedded
 * `@font-face` rules. Strips the custom-property declarations and the
 * fluid-sizing properties from the root `style`.
 */
export function finalizeStandaloneSvg(
  markup: string,
  options: FinalizeSvgOptions,
): string {
  const root = parseSvgDocument(markup)
  const viewBox = parseViewBox(root) ?? {
    minX: 0,
    minY: 0,
    width: toPositiveNumber(root.getAttribute('width')) ?? 1,
    height: toPositiveNumber(root.getAttribute('height')) ?? 1,
  }

  root.setAttribute('width', String(viewBox.width))
  root.setAttribute('height', String(viewBox.height))

  if (!root.hasAttribute('viewBox')) {
    root.setAttribute(
      'viewBox',
      `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`,
    )
  }

  if (!root.hasAttribute('xmlns')) {
    root.setAttribute('xmlns', SVG_NAMESPACE)
  }

  if (!root.hasAttribute('xmlns:xlink')) {
    root.setAttributeNS(XMLNS_NAMESPACE, 'xmlns:xlink', XLINK_NAMESPACE)
  }

  const cleanedStyle = cleanRootStyle(root.getAttribute('style') ?? '')

  if (cleanedStyle === '') {
    root.removeAttribute('style')
  } else {
    root.setAttribute('style', cleanedStyle)
  }

  const insertions: Element[] = [
    createBackgroundRect(root, viewBox, options.background),
  ]

  if (options.fontFaceCss !== '') {
    insertions.push(createFontDefs(root, options.fontFaceCss))
  }

  for (const element of insertions.reverse()) {
    root.insertBefore(element, root.firstChild)
  }

  return new XMLSerializer().serializeToString(root)
}
