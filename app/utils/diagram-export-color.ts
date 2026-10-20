const PROBE_FIRST: string = 'rgb(1, 2, 3)'
const PROBE_SECOND: string = 'rgb(250, 251, 252)'
const CURRENT_COLOR_PATTERN: RegExp = /^currentcolor$/i
const BYTE_RADIX: number = 16
const OPAQUE_ALPHA: number = 255
const HEX_COLOR_PATTERN: RegExp = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i

export interface RgbaColor {
  red: number
  green: number
  blue: number
  alpha: number
}

const WHITE: RgbaColor = { red: 255, green: 255, blue: 255, alpha: 255 }

export type ColorConverter = (value: string) => string | null

function toHexByte(value: number): string {
  return value.toString(BYTE_RADIX).padStart(2, '0')
}

export function formatHexColor(
  red: number,
  green: number,
  blue: number,
  alpha: number,
): string {
  if (alpha === 0) {
    return '#00000000'
  }

  const hex = `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`

  return alpha === OPAQUE_ALPHA ? hex : `${hex}${toHexByte(alpha)}`
}

export function parseHexColor(value: string): RgbaColor | null {
  const match = HEX_COLOR_PATTERN.exec(value.trim())

  if (!match) {
    return null
  }

  const channels = match[1] ?? ''
  const alpha = match[2]

  return {
    red: Number.parseInt(channels.slice(0, 2), BYTE_RADIX),
    green: Number.parseInt(channels.slice(2, 4), BYTE_RADIX),
    blue: Number.parseInt(channels.slice(4, 6), BYTE_RADIX),
    alpha: alpha === undefined
      ? OPAQUE_ALPHA
      : Number.parseInt(alpha, BYTE_RADIX),
  }
}

function blendChannel(
  foreground: number,
  backdrop: number,
  opacity: number,
): number {
  return Math.round(foreground * opacity + backdrop * (1 - opacity))
}

/**
 * Flattens a `#rrggbb` or `#rrggbbaa` color to an opaque `#rrggbb` by
 * compositing it over `backdrop`, treated as opaque (white when it is not a
 * hex color). Returns `null` when `color` is missing or not a hex color.
 */
export function toOpaqueColor(
  color: string | undefined,
  backdrop: string,
): string | null {
  const foreground = color === undefined ? null : parseHexColor(color)

  if (!foreground) {
    return null
  }

  const base = parseHexColor(backdrop) ?? WHITE
  const opacity = foreground.alpha / OPAQUE_ALPHA

  return formatHexColor(
    blendChannel(foreground.red, base.red, opacity),
    blendChannel(foreground.green, base.green, opacity),
    blendChannel(foreground.blue, base.blue, opacity),
    OPAQUE_ALPHA,
  )
}

export function createColorContext(): CanvasRenderingContext2D | null {
  try {
    const canvas = document.createElement('canvas')

    canvas.width = 1
    canvas.height = 1

    return canvas.getContext('2d', { willReadFrequently: true })
  } catch {
    return null
  }
}

/**
 * Builds a converter that rasterizes any CSS color the browser understands
 * (`oklch()`, `color-mix()`, ...) through a 1x1 canvas into `#rrggbb` or
 * `#rrggbbaa`. Returns `null` for values that are not colors: assigning an
 * invalid value leaves `fillStyle` untouched, which two different probe
 * colors detect without mistaking the stale value for a result.
 */
export function createColorConverter(
  context: CanvasRenderingContext2D | null,
): ColorConverter {
  return (value: string): string | null => {
    const color = value.trim()

    if (!context || color === '' || CURRENT_COLOR_PATTERN.test(color)) {
      return null
    }

    context.fillStyle = PROBE_FIRST
    context.fillStyle = color

    const firstReadback = context.fillStyle

    context.fillStyle = PROBE_SECOND
    context.fillStyle = color

    if (firstReadback !== context.fillStyle) {
      return null
    }

    context.clearRect(0, 0, 1, 1)
    context.fillRect(0, 0, 1, 1)

    const pixel = context.getImageData(0, 0, 1, 1).data
    const [red = 0, green = 0, blue = 0, alpha = 0] = pixel

    return formatHexColor(red, green, blue, alpha)
  }
}
