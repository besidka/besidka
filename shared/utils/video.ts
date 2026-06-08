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
 * Convert authored markers into Plyr marker points: timecodes resolved to
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
