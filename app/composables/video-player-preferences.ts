import type { MediaTextTrack } from '@videojs/html'
import type { VideoPlayerElement } from '@videojs/html/video'

type VideoPlayerStore = VideoPlayerElement['store']

export interface VideoPlayerCaptionsPreference {
  enabled: boolean
  language: string | null
}

export interface VideoPlayerPreferences {
  volume: number
  muted: boolean
  speed: number
  quality: number | null
  captions: VideoPlayerCaptionsPreference
}

interface VideoPlayerPreferencesOptions {
  getQuality: () => number | null
  getSpeed: () => number
  applyQuality: (quality: number) => void
  applySpeed: (speed: number) => void
}

export const VIDEO_PLAYER_STORAGE_KEY = 'video-player'
export const LEGACY_PLYR_STORAGE_KEY = 'plyr'

const CAPTION_KINDS = new Set(['captions', 'subtitles'])

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseCaptions(value: unknown): VideoPlayerCaptionsPreference | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (typeof candidate.enabled !== 'boolean') {
    return null
  }

  return {
    enabled: candidate.enabled,
    language: typeof candidate.language === 'string'
      ? candidate.language
      : null,
  }
}

/** Validates a stored preferences object; returns null for anything else. */
export function parseVideoPlayerPreferences(
  raw: string | null,
): VideoPlayerPreferences | null {
  if (!raw) {
    return null
  }

  let value: unknown

  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>
  const captions = parseCaptions(candidate.captions)

  if (
    !isFiniteNumber(candidate.volume)
    || typeof candidate.muted !== 'boolean'
    || !isFiniteNumber(candidate.speed)
    || !captions
  ) {
    return null
  }

  return {
    volume: Math.min(1, Math.max(0, candidate.volume)),
    muted: candidate.muted,
    speed: candidate.speed,
    quality: isFiniteNumber(candidate.quality) ? candidate.quality : null,
    captions,
  }
}

export function removeLegacyPlyrPreferences(): void {
  try {
    localStorage.removeItem(LEGACY_PLYR_STORAGE_KEY)
  } catch {
    return
  }
}

function captionTracks(store: VideoPlayerStore): MediaTextTrack[] {
  const tracks: MediaTextTrack[] = store.textTrackList

  return tracks.filter((track) => {
    return CAPTION_KINDS.has(track.kind)
  })
}

function readCaptions(store: VideoPlayerStore): VideoPlayerCaptionsPreference {
  const showing = captionTracks(store).find((track) => {
    return track.mode === 'showing'
  })

  return {
    enabled: !!showing,
    language: showing?.language || null,
  }
}

function isSamePreferences(
  left: VideoPlayerPreferences | null,
  right: VideoPlayerPreferences,
): boolean {
  return !!left
    && left.volume === right.volume
    && left.muted === right.muted
    && left.speed === right.speed
    && left.quality === right.quality
    && left.captions.enabled === right.captions.enabled
    && left.captions.language === right.captions.language
}

/**
 * Persists volume, mute, speed, quality and captions for the landing player
 * under the `video-player` key through `usePreferenceStorage()`, which gates
 * it on the `preferences` consent category (see docs/cookie-consent.md).
 * Saved values are restored once the store attaches to the media; captions
 * are restored when the first caption track list arrives.
 */
export function useVideoPlayerPreferences(
  options: VideoPlayerPreferencesOptions,
) {
  const nuxtApp = useNuxtApp()
  const preferenceStorage = usePreferenceStorage()

  let store: VideoPlayerStore | null = null
  let unsubscribe: (() => void) | null = null
  let pendingCaptions: VideoPlayerCaptionsPreference | null = null
  let hasSeenCaptions = false
  let hasRestored = false
  let lastSaved: VideoPlayerPreferences | null = null

  function readStoredPreferences(): VideoPlayerPreferences | null {
    try {
      const raw = nuxtApp.runWithContext(() => {
        return preferenceStorage.getItem(VIDEO_PLAYER_STORAGE_KEY)
      })

      return parseVideoPlayerPreferences(typeof raw === 'string' ? raw : null)
    } catch (exception) {
      void exception

      return null
    }
  }

  function writeStoredPreferences(preferences: VideoPlayerPreferences) {
    try {
      nuxtApp.runWithContext(() => {
        preferenceStorage.setItem(
          VIDEO_PLAYER_STORAGE_KEY,
          JSON.stringify(preferences),
        )
      })
    } catch (exception) {
      void exception
    }
  }

  function readSavedQuality(): number | null {
    return readStoredPreferences()?.quality ?? null
  }

  function snapshot(): VideoPlayerPreferences | null {
    if (!store) {
      return null
    }

    return {
      volume: store.volume,
      muted: store.muted,
      speed: options.getSpeed(),
      quality: options.getQuality() ?? lastSaved?.quality ?? null,
      captions: hasSeenCaptions || !pendingCaptions
        ? readCaptions(store)
        : pendingCaptions,
    }
  }

  function persist() {
    const next = snapshot()

    if (!next || isSamePreferences(lastSaved, next)) {
      return
    }

    lastSaved = next
    writeStoredPreferences(next)
  }

  function restoreCaptions(currentStore: VideoPlayerStore) {
    const tracks = captionTracks(currentStore)

    if (hasSeenCaptions || !tracks.length) {
      return
    }

    hasSeenCaptions = true

    const saved = pendingCaptions

    pendingCaptions = null

    if (!saved?.enabled) {
      return
    }

    const match = tracks.find((track) => {
      return !saved.language || track.language === saved.language
    })

    if (match) {
      currentStore.selectSubtitlesTrack(match.id)
    }
  }

  function restore(currentStore: VideoPlayerStore) {
    if (hasRestored || !currentStore.target) {
      return
    }

    hasRestored = true

    const saved = readStoredPreferences()

    if (!saved) {
      return
    }

    lastSaved = saved
    pendingCaptions = saved.captions

    options.applySpeed(saved.speed)

    if (saved.quality !== null) {
      options.applyQuality(saved.quality)
    }
    currentStore.setVolume(saved.volume)

    if (saved.muted) {
      currentStore.setMuted(true)
    }
  }

  function onStoreChange() {
    if (!store) {
      return
    }

    restore(store)

    if (!hasRestored) {
      return
    }

    restoreCaptions(store)
    persist()
  }

  function attach(player: VideoPlayerElement) {
    if (store) {
      return
    }

    store = player.store
    unsubscribe = store.subscribe(onStoreChange)
    onStoreChange()
  }

  function detach() {
    unsubscribe?.()
    unsubscribe = null
    store = null
  }

  tryOnScopeDispose(detach)

  return { attach, detach, persist, readSavedQuality }
}
