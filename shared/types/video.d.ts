/**
 * Landing demo video player types.
 *
 * These describe the `video` frontmatter object in content/index.md (edited in
 * Nuxt Studio) and are consumed by the themed Plyr player on the home page.
 * Kept framework-agnostic (no Plyr import) so they can be shared by the
 * content schema, the player component, and the thumbnail composable.
 */

/** A single selectable resolution for the quality menu. */
export interface VideoQuality {
  /** Source URL, e.g. /videos/demo-720.mp4 served from R2_LANDING. */
  src: string
  /** Frame height in pixels (Plyr keys the quality menu off this), e.g. 720. */
  size: number
  /** Optional human label; falls back to `${size}p` when omitted. */
  label?: string
}

/** A WebVTT caption/subtitle track. */
export interface VideoCaption {
  /** WebVTT file URL, e.g. /videos/demo.en.vtt served from R2_LANDING. */
  src: string
  /** Menu label, e.g. "English". */
  label: string
  /** BCP 47 language tag, e.g. "en". */
  srclang: string
  /** Whether this track is active by default. */
  default?: boolean
}

/** A chapter marker rendered on the progress bar. */
export interface VideoMarker {
  /** Timecode as "m:ss", "mm:ss", or "h:mm:ss". */
  time: string
  /** Chapter label shown on hover, e.g. "Projects". */
  label: string
}

/** Normalized marker with the timecode resolved to seconds for Plyr. */
export interface VideoMarkerPoint {
  time: number
  label: string
}

/** The full `video` frontmatter object. */
export interface VideoData {
  /** Default/primary source URL (used as poster fallback and base quality). */
  src?: string
  /** Poster image URL shown before playback. */
  poster?: string
  /** Short caption shown below the player. */
  caption?: string
  /** Selectable resolutions for the quality menu. */
  qualities?: VideoQuality[]
  /** WebVTT caption tracks. */
  captions?: VideoCaption[]
  /** Chapter markers authored as timecodes. */
  markers?: VideoMarker[]
  /**
   * Whether to generate hover-preview thumbnails on the client via mediabunny.
   * Defaults to true when omitted.
   */
  thumbnails?: boolean
}
