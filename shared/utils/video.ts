import type { VideoMarker, VideoMarkerPoint } from '#shared/types/video.d'

/**
 * Parse a "m:ss", "mm:ss", or "h:mm:ss" timecode into total seconds.
 *
 * Returns null for malformed input (wrong segment count, non-numeric parts,
 * negative values, or minutes/seconds >= 60) so callers can skip bad markers
 * instead of feeding NaN into the player.
 */
export function parseTimecodeToSeconds(timecode: string): number | null {
  const parts = timecode.trim().split(':')

  if (parts.length < 2 || parts.length > 3) {
    return null
  }

  // Each segment must be a plain non-negative integer. Number() alone is too
  // permissive — it accepts '', '1e1', '0x1', 'Infinity', and decimals, which
  // would silently produce wrong (or Infinity) marker times.
  const allIntegers = parts.every((part) => {
    return /^\d+$/.test(part)
  })

  if (!allIntegers) {
    return null
  }

  const numbers = parts.map((part) => {
    return Number(part)
  })

  if (numbers.length === 3) {
    const [hours, minutes, seconds] = numbers as [number, number, number]

    if (minutes >= 60 || seconds >= 60) {
      return null
    }

    return hours * 3600 + minutes * 60 + seconds
  }

  const [minutes, seconds] = numbers as [number, number]

  if (seconds >= 60) {
    return null
  }

  return minutes * 60 + seconds
}

/**
 * Convert authored markers into chapter points: timecodes resolved to
 * seconds, invalid entries dropped, and the result sorted by time.
 */
export function toMarkerPoints(
  markers: VideoMarker[] | undefined | null,
): VideoMarkerPoint[] {
  if (!markers?.length) {
    return []
  }

  const points: VideoMarkerPoint[] = []

  for (const marker of markers) {
    const time = parseTimecodeToSeconds(marker.time)

    if (time === null) {
      continue
    }

    points.push({ time, label: marker.label })
  }

  return points.sort((a, b) => {
    return a.time - b.time
  })
}

const ISO_DURATION_PATTERN = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/

/**
 * Parse an ISO 8601 time duration such as "PT1M12S" into total seconds.
 * Returns null for anything that is not a plain PT...H...M...S duration.
 */
export function parseIsoDurationToSeconds(duration: string): number | null {
  const match = ISO_DURATION_PATTERN.exec(duration)

  if (!match || duration === 'PT') {
    return null
  }

  const [, hours, minutes, seconds] = match

  return Number(hours ?? 0) * 3600
    + Number(minutes ?? 0) * 60
    + Number(seconds ?? 0)
}

/**
 * Read a `?t=<seconds>` deep-link value. Only a single plain non-negative
 * integer string below the video duration is accepted; arrays, decimals,
 * signs and anything out of range return null so the player starts at 0.
 */
export function parseVideoStartOffset(
  value: unknown,
  durationSeconds: number | null,
): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null
  }

  const offset = Number(value)

  if (
    !Number.isSafeInteger(offset)
    || durationSeconds === null
    || offset >= durationSeconds
  ) {
    return null
  }

  return offset
}

const CONSTRAINED_EFFECTIVE_TYPES = new Set(['slow-2g', '2g', '3g'])
const MIN_DEVICE_PIXEL_RATIO = 1
const MAX_DEVICE_PIXEL_RATIO = 2
const VIDEO_ASPECT_RATIO = 9 / 16

export interface InitialQualityInput {
  sizes: number[]
  playerWidth: number
  devicePixelRatio: number
  saveData?: boolean
  effectiveType?: string
}

function clampDevicePixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio)) {
    return MIN_DEVICE_PIXEL_RATIO
  }

  return Math.min(
    MAX_DEVICE_PIXEL_RATIO,
    Math.max(MIN_DEVICE_PIXEL_RATIO, devicePixelRatio),
  )
}

/**
 * Pick the rendition height a player should start on. A data-saver or slow
 * connection gets the lowest rendition. Otherwise the target height is the
 * rendered width times the pixel ratio (clamped to 2, so a 3x phone does not
 * pull a rendition it cannot show) times 9/16, and the smallest rendition
 * that covers it wins, or the largest when none does. Returns null when no
 * rendition exists or the width cannot be measured, so the caller applies its
 * own default.
 */
export function pickInitialQuality(
  input: InitialQualityInput,
): number | null {
  const sizes = input.sizes.filter((size) => {
    return Number.isFinite(size) && size > 0
  }).sort((a, b) => {
    return a - b
  })

  if (!sizes.length) {
    return null
  }

  const isConstrained = input.saveData === true
    || CONSTRAINED_EFFECTIVE_TYPES.has(input.effectiveType ?? '')

  if (isConstrained) {
    return sizes[0]!
  }

  if (!Number.isFinite(input.playerWidth) || input.playerWidth <= 0) {
    return null
  }

  const targetHeight = input.playerWidth
    * clampDevicePixelRatio(input.devicePixelRatio)
    * VIDEO_ASPECT_RATIO

  return sizes.find((size) => {
    return size >= targetHeight
  }) ?? sizes[sizes.length - 1]!
}
