export interface OklabColor {
  lightness: number
  a: number
  b: number
  alpha: number
}

export interface RgbColor {
  red: number
  green: number
  blue: number
}

export type CssVariables = Record<string, string>

const NAMED_COLORS: Record<string, OklabColor> = {
  transparent: { lightness: 0, a: 0, b: 0, alpha: 0 },
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (const character of value) {
    if (character === '(') {
      depth += 1
    }

    if (character === ')') {
      depth -= 1
    }

    if (character === separator && depth === 0) {
      parts.push(current.trim())
      current = ''

      continue
    }

    current += character
  }

  if (current.trim()) {
    parts.push(current.trim())
  }

  return parts
}

function readFunctionArguments(value: string, name: string): string | null {
  if (!value.startsWith(`${name}(`) || !value.endsWith(')')) {
    return null
  }

  return value.slice(name.length + 1, -1)
}

function linearToSrgb(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel))

  return clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * clamped ** (1 / 2.4) - 0.055
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
}

function oklchToOklab(
  lightness: number,
  chroma: number,
  hueDegrees: number,
  alpha: number,
): OklabColor {
  const hue = (hueDegrees * Math.PI) / 180

  return {
    lightness,
    a: chroma * Math.cos(hue),
    b: chroma * Math.sin(hue),
    alpha,
  }
}

function srgbToOklab(
  red: number,
  green: number,
  blue: number,
  alpha: number,
): OklabColor {
  const linearRed = srgbToLinear(red)
  const linearGreen = srgbToLinear(green)
  const linearBlue = srgbToLinear(blue)
  const long = Math.cbrt(
    0.4122214708 * linearRed
    + 0.5363325363 * linearGreen
    + 0.0514459929 * linearBlue,
  )
  const medium = Math.cbrt(
    0.2119034982 * linearRed
    + 0.6806995451 * linearGreen
    + 0.1073969566 * linearBlue,
  )
  const short = Math.cbrt(
    0.0883024619 * linearRed
    + 0.2817188376 * linearGreen
    + 0.6299787005 * linearBlue,
  )

  return {
    lightness: 0.2104542553 * long
      + 0.793617785 * medium
      - 0.0040720468 * short,
    a: 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    b: 0.0259040371 * long + 0.7827717662 * medium - 0.8086757660 * short,
    alpha,
  }
}

function parseHexColor(value: string): OklabColor | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)

  if (!match) {
    return null
  }

  const digits = match[1]!.length === 3
    ? match[1]!.split('').map(digit => digit + digit).join('')
    : match[1]!
  const [red, green, blue] = [0, 2, 4].map((offset) => {
    return Number.parseInt(digits.slice(offset, offset + 2), 16) / 255
  })

  return srgbToOklab(red!, green!, blue!, 1)
}

function parseOklchColor(value: string): OklabColor | null {
  const body = readFunctionArguments(value, 'oklch')

  if (body === null) {
    return null
  }

  const [channels = '', alphaText] = body.split('/').map(part => part.trim())
  const [lightnessText = '0', chromaText = '0', hueText = '0'] = channels
    .split(/\s+/)
  const lightness = lightnessText.endsWith('%')
    ? Number.parseFloat(lightnessText) / 100
    : Number.parseFloat(lightnessText)
  const alpha = alphaText === undefined
    ? 1
    : alphaText.endsWith('%')
      ? Number.parseFloat(alphaText) / 100
      : Number.parseFloat(alphaText)

  return oklchToOklab(
    lightness,
    Number.parseFloat(chromaText),
    Number.parseFloat(hueText),
    alpha,
  )
}

function parseMixOperand(
  operand: string,
  variables: CssVariables,
): { color: OklabColor, percentage: number | null } {
  const match = /^(.*?)(?:\s+(\d+(?:\.\d+)?)%)?$/s.exec(operand)
  const colorText = match?.[1]?.trim() ?? operand
  const percentage = match?.[2] === undefined
    ? null
    : Number.parseFloat(match[2])

  return { color: resolveColor(colorText, variables), percentage }
}

function mixInOklab(
  first: { color: OklabColor, percentage: number | null },
  second: { color: OklabColor, percentage: number | null },
): OklabColor {
  let firstWeight = first.percentage
  let secondWeight = second.percentage

  if (firstWeight === null && secondWeight === null) {
    firstWeight = 50
    secondWeight = 50
  } else if (firstWeight === null) {
    firstWeight = 100 - secondWeight!
  } else if (secondWeight === null) {
    secondWeight = 100 - firstWeight
  }

  const total = firstWeight + secondWeight!
  const normalizedFirst = firstWeight / total
  const normalizedSecond = secondWeight! / total
  const alpha = first.color.alpha * normalizedFirst
    + second.color.alpha * normalizedSecond

  if (alpha === 0) {
    return { lightness: 0, a: 0, b: 0, alpha: 0 }
  }

  const mixChannel = (firstValue: number, secondValue: number) => {
    return (
      firstValue * first.color.alpha * normalizedFirst
      + secondValue * second.color.alpha * normalizedSecond
    ) / alpha
  }

  return {
    lightness: mixChannel(first.color.lightness, second.color.lightness),
    a: mixChannel(first.color.a, second.color.a),
    b: mixChannel(first.color.b, second.color.b),
    alpha,
  }
}

export function resolveColor(
  value: string,
  variables: CssVariables,
): OklabColor {
  const trimmed = value.trim()
  const variableBody = readFunctionArguments(trimmed, 'var')

  if (variableBody !== null) {
    const [name = '', fallback] = splitTopLevel(variableBody, ',')
    const resolved = variables[name]

    if (resolved !== undefined) {
      return resolveColor(resolved, variables)
    }

    if (fallback !== undefined) {
      return resolveColor(fallback, variables)
    }

    throw new Error(`Unresolved CSS variable ${name}`)
  }

  const mixBody = readFunctionArguments(trimmed, 'color-mix')

  if (mixBody !== null) {
    const [method, firstOperand, secondOperand] = splitTopLevel(mixBody, ',')

    if (method !== 'in oklab' || !firstOperand || !secondOperand) {
      throw new Error(`Unsupported color-mix: ${trimmed}`)
    }

    return mixInOklab(
      parseMixOperand(firstOperand, variables),
      parseMixOperand(secondOperand, variables),
    )
  }

  const color = NAMED_COLORS[trimmed]
    ?? parseHexColor(trimmed)
    ?? parseOklchColor(trimmed)

  if (!color) {
    throw new Error(`Unsupported color value: ${trimmed}`)
  }

  return color
}

function encodeChannel(linearChannel: number): number {
  return Math.round(linearToSrgb(linearChannel) * 255) / 255
}

export function oklabToSrgb(color: OklabColor): RgbColor {
  const long = (
    color.lightness + 0.3963377774 * color.a + 0.2158037573 * color.b
  ) ** 3
  const medium = (
    color.lightness - 0.1055613458 * color.a - 0.0638541728 * color.b
  ) ** 3
  const short = (
    color.lightness - 0.0894841775 * color.a - 1.291485548 * color.b
  ) ** 3

  return {
    red: encodeChannel(
      4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    ),
    green: encodeChannel(
      -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    ),
    blue: encodeChannel(
      -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
    ),
  }
}

export function compositeOver(
  foreground: OklabColor,
  background: OklabColor,
): RgbColor {
  const front = oklabToSrgb(foreground)
  const back = oklabToSrgb(background)
  const blend = (frontValue: number, backValue: number) => {
    return frontValue * foreground.alpha + backValue * (1 - foreground.alpha)
  }

  return {
    red: blend(front.red, back.red),
    green: blend(front.green, back.green),
    blue: blend(front.blue, back.blue),
  }
}

export function relativeLuminance(color: RgbColor): number {
  return 0.2126 * srgbToLinear(color.red)
    + 0.7152 * srgbToLinear(color.green)
    + 0.0722 * srgbToLinear(color.blue)
}

export function contrastRatio(
  foreground: OklabColor,
  background: OklabColor,
): number {
  const foregroundLuminance = relativeLuminance(
    compositeOver(foreground, background),
  )
  const backgroundLuminance = relativeLuminance(oklabToSrgb(background))
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)

  return (lighter + 0.05) / (darker + 0.05)
}

export function oklabDistance(first: OklabColor, second: OklabColor): number {
  return Math.hypot(
    first.lightness - second.lightness,
    first.a - second.a,
    first.b - second.b,
  )
}

export function parseDeclarations(block: string): CssVariables {
  const declarations: CssVariables = {}

  for (const declaration of splitTopLevel(block, ';')) {
    const separatorIndex = declaration.indexOf(':')

    if (separatorIndex === -1) {
      continue
    }

    declarations[declaration.slice(0, separatorIndex).trim()] = declaration
      .slice(separatorIndex + 1)
      .replace(/\s+/g, ' ')
      .trim()
  }

  return declarations
}

export function extractBlock(css: string, openingPattern: RegExp): string {
  const match = openingPattern.exec(css)

  if (!match) {
    throw new Error(`Block not found: ${openingPattern}`)
  }

  const start = css.indexOf('{', match.index) + 1
  const end = css.indexOf('}', start)

  return css.slice(start, end)
}
