import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { effectScope } from 'vue'
import type { EffectScope } from 'vue'
import type { VideoPlayerElement } from '@videojs/html/video'
import {
  VIDEO_PLAYER_STORAGE_KEY,
  parseVideoPlayerPreferences,
  removeLegacyPlyrPreferences,
  useVideoPlayerPreferences,
} from '../../../app/composables/video-player-preferences'
import { usePreferenceStorage } from '../../../app/composables/preference-storage'
import { createStorageStub } from '../../setup/helpers/video-player'

interface FakeTextTrack {
  id: string
  kind: string
  language: string
  mode: 'disabled' | 'hidden' | 'showing'
}

const mocks = vi.hoisted(() => {
  return {
    isAllowed: vi.fn((_categoryId: string) => true),
    onConsentChange: vi.fn(),
  }
})

mockNuxtImport('useCookieConsent', () => {
  return () => {
    return {
      isAllowed: mocks.isAllowed,
      onConsentChange: mocks.onConsentChange,
    }
  }
})

const DEFAULT_PREFERENCES = {
  volume: 0.4,
  muted: true,
  speed: 1.5,
  quality: 1080,
  qualityChosen: true,
  captions: { enabled: false, language: null },
}

function serialize(value: unknown): string {
  return JSON.stringify(value)
}

describe('parseVideoPlayerPreferences', () => {
  it('parses a valid preferences object', () => {
    expect(parseVideoPlayerPreferences(serialize(DEFAULT_PREFERENCES)))
      .toEqual(DEFAULT_PREFERENCES)
  })

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['invalid JSON', '{not json'],
    ['a truncated object', '{"volume":0.5,'],
    ['the JSON null literal', 'null'],
    ['a JSON number', '42'],
    ['a JSON string', '"volume"'],
    ['a JSON boolean', 'true'],
    ['an empty array', '[]'],
    ['an empty object', '{}'],
  ])('returns null for %s', (_label, raw) => {
    expect(parseVideoPlayerPreferences(raw)).toBeNull()
  })

  it.each([
    ['a string volume', { ...DEFAULT_PREFERENCES, volume: '0.5' }],
    ['a missing volume', { ...DEFAULT_PREFERENCES, volume: undefined }],
    ['a null volume', { ...DEFAULT_PREFERENCES, volume: null }],
    ['a string muted flag', { ...DEFAULT_PREFERENCES, muted: 'true' }],
    ['a missing muted flag', { ...DEFAULT_PREFERENCES, muted: undefined }],
    ['a string speed', { ...DEFAULT_PREFERENCES, speed: '1.5' }],
    ['a missing speed', { ...DEFAULT_PREFERENCES, speed: undefined }],
    ['missing captions', { ...DEFAULT_PREFERENCES, captions: undefined }],
    ['null captions', { ...DEFAULT_PREFERENCES, captions: null }],
    ['string captions', { ...DEFAULT_PREFERENCES, captions: 'on' }],
    [
      'a non-boolean captions flag',
      { ...DEFAULT_PREFERENCES, captions: { enabled: 'yes' } },
    ],
  ])('returns null for %s', (_label, value) => {
    expect(parseVideoPlayerPreferences(serialize(value))).toBeNull()
  })

  it('clamps the volume into the 0..1 range', () => {
    expect(parseVideoPlayerPreferences(
      serialize({ ...DEFAULT_PREFERENCES, volume: 7 }),
    )?.volume).toBe(1)
    expect(parseVideoPlayerPreferences(
      serialize({ ...DEFAULT_PREFERENCES, volume: -3 }),
    )?.volume).toBe(0)
  })

  it('parses a record without qualityChosen as not chosen', () => {
    const { qualityChosen: _qualityChosen, ...legacy } = DEFAULT_PREFERENCES

    expect(parseVideoPlayerPreferences(serialize(legacy))).toEqual({
      ...DEFAULT_PREFERENCES,
      qualityChosen: false,
    })
  })

  it.each([
    ['a string flag', 'true'],
    ['a numeric flag', 1],
    ['a null flag', null],
  ])('treats %s as not chosen', (_label, qualityChosen) => {
    expect(parseVideoPlayerPreferences(
      serialize({ ...DEFAULT_PREFERENCES, qualityChosen }),
    )?.qualityChosen).toBe(false)
  })

  it('never reports a chosen quality without a quality', () => {
    expect(parseVideoPlayerPreferences(
      serialize({ ...DEFAULT_PREFERENCES, quality: null }),
    )).toMatchObject({ quality: null, qualityChosen: false })
  })

  it('falls back to a null quality for non-numeric values', () => {
    expect(parseVideoPlayerPreferences(
      serialize({ ...DEFAULT_PREFERENCES, quality: '720' }),
    )?.quality).toBeNull()
    expect(parseVideoPlayerPreferences(
      serialize({ ...DEFAULT_PREFERENCES, quality: undefined }),
    )?.quality).toBeNull()
  })

  it('falls back to a null caption language for non-string values', () => {
    const parsed = parseVideoPlayerPreferences(serialize({
      ...DEFAULT_PREFERENCES,
      captions: { enabled: true, language: 7 },
    }))

    expect(parsed?.captions).toEqual({ enabled: true, language: null })
  })

  it('keeps a string caption language', () => {
    const parsed = parseVideoPlayerPreferences(serialize({
      ...DEFAULT_PREFERENCES,
      captions: { enabled: true, language: 'uk' },
    }))

    expect(parsed?.captions).toEqual({ enabled: true, language: 'uk' })
  })

  it('drops unknown fields', () => {
    const parsed = parseVideoPlayerPreferences(serialize({
      ...DEFAULT_PREFERENCES,
      extra: 'ignored',
    }))

    expect(parsed).toEqual(DEFAULT_PREFERENCES)
  })
})

describe('removeLegacyPlyrPreferences', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createStorageStub()
    vi.stubGlobal('localStorage', storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('removes the legacy plyr key only', () => {
    storage.setItem('plyr', serialize({ volume: 1 }))
    storage.setItem(VIDEO_PLAYER_STORAGE_KEY, serialize(DEFAULT_PREFERENCES))

    removeLegacyPlyrPreferences()

    expect(storage.getItem('plyr')).toBeNull()
    expect(storage.getItem(VIDEO_PLAYER_STORAGE_KEY)).not.toBeNull()
  })

  it('does nothing when the legacy key is absent', () => {
    expect(() => {
      removeLegacyPlyrPreferences()
    }).not.toThrow()
  })

  it('swallows storage access errors', () => {
    vi.stubGlobal('localStorage', {
      removeItem: () => {
        throw new Error('storage blocked')
      },
    })

    expect(() => {
      removeLegacyPlyrPreferences()
    }).not.toThrow()
  })
})

describe('useVideoPlayerPreferences', () => {
  let storage: Storage
  let scope: EffectScope

  function createFakeStore(overrides: Record<string, unknown> = {}) {
    const listeners = new Set<() => void>()
    const store = {
      target: {} as unknown,
      volume: 1,
      muted: false,
      textTrackList: [] as FakeTextTrack[],
      setVolume: vi.fn((volume: number) => {
        store.volume = volume
      }),
      setMuted: vi.fn((muted: boolean) => {
        store.muted = muted
      }),
      selectSubtitlesTrack: vi.fn(),
      unsubscribe: vi.fn(),
      subscribe: vi.fn((listener: () => void) => {
        listeners.add(listener)

        return () => {
          store.unsubscribe()
          listeners.delete(listener)
        }
      }),
      notify: () => {
        for (const listener of [...listeners]) {
          listener()
        }
      },
      ...overrides,
    }

    return store
  }

  function createPlayer(store: ReturnType<typeof createFakeStore>) {
    return { store } as unknown as VideoPlayerElement
  }

  function mountPreferences() {
    const options = {
      getQuality: vi.fn((): number | null => {
        return 720
      }),
      getSpeed: vi.fn(() => {
        return 1
      }),
      applyQuality: vi.fn(),
      applySpeed: vi.fn(),
    }
    const preferences = scope.run(() => {
      return useVideoPlayerPreferences(options)
    })!

    return { ...preferences, options }
  }

  function readStored() {
    return parseVideoPlayerPreferences(
      storage.getItem(VIDEO_PLAYER_STORAGE_KEY),
    )
  }

  beforeEach(() => {
    storage = createStorageStub()
    scope = effectScope()
    vi.stubGlobal('localStorage', storage)
    mocks.isAllowed.mockReset().mockReturnValue(true)
    mocks.onConsentChange.mockReset()
    usePreferenceStorage().removeItem(VIDEO_PLAYER_STORAGE_KEY)
  })

  afterEach(() => {
    scope.stop()
    usePreferenceStorage().removeItem(VIDEO_PLAYER_STORAGE_KEY)
    vi.unstubAllGlobals()
  })

  describe('consent gating', () => {
    it('writes the current state when consent is granted', () => {
      const { attach } = mountPreferences()
      const store = createFakeStore({ volume: 0.8, muted: true })

      attach(createPlayer(store))

      expect(readStored()).toEqual({
        volume: 0.8,
        muted: true,
        speed: 1,
        quality: 720,
        qualityChosen: true,
        captions: { enabled: false, language: null },
      })
    })

    it('writes nothing to localStorage when consent is denied', () => {
      mocks.isAllowed.mockReturnValue(false)

      const { attach, persist } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      store.setVolume(0.2)
      store.notify()
      persist()

      expect(storage.getItem(VIDEO_PLAYER_STORAGE_KEY)).toBeNull()
    })

    it('ignores saved localStorage values when consent is denied', () => {
      mocks.isAllowed.mockReturnValue(false)
      storage.setItem(VIDEO_PLAYER_STORAGE_KEY, serialize(DEFAULT_PREFERENCES))

      const { attach, options } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))

      expect(options.applySpeed).not.toHaveBeenCalled()
      expect(options.applyQuality).not.toHaveBeenCalled()
      expect(store.setVolume).not.toHaveBeenCalled()
    })

    it('removes the real key when a write happens after consent is denied',
      () => {
        const { attach } = mountPreferences()
        const store = createFakeStore()

        attach(createPlayer(store))

        expect(storage.getItem(VIDEO_PLAYER_STORAGE_KEY)).not.toBeNull()

        mocks.isAllowed.mockReturnValue(false)
        store.setVolume(0.2)
        store.notify()

        expect(storage.getItem(VIDEO_PLAYER_STORAGE_KEY)).toBeNull()
      })

    it('remembers choices in-session while denied and flushes on grant',
      () => {
        mocks.isAllowed.mockReturnValue(false)

        const { attach } = mountPreferences()
        const store = createFakeStore({ volume: 0.6 })

        attach(createPlayer(store))

        expect(storage.getItem(VIDEO_PLAYER_STORAGE_KEY)).toBeNull()

        mocks.isAllowed.mockReturnValue(true)
        usePreferenceStorage().flushPending()

        expect(readStored()).toMatchObject({ volume: 0.6 })
      })

    it('restores the in-session choices in a later instance while denied',
      () => {
        mocks.isAllowed.mockReturnValue(false)

        const first = mountPreferences()
        const firstStore = createFakeStore({ volume: 0.3, muted: true })

        first.attach(createPlayer(firstStore))
        first.detach()

        const second = mountPreferences()
        const secondStore = createFakeStore()

        second.attach(createPlayer(secondStore))

        expect(secondStore.setVolume).toHaveBeenCalledWith(0.3)
        expect(secondStore.setMuted).toHaveBeenCalledWith(true)
        expect(storage.getItem(VIDEO_PLAYER_STORAGE_KEY)).toBeNull()
      })
  })

  describe('quality without options', () => {
    it('keeps the saved quality on a player without quality options', () => {
      storage.setItem(VIDEO_PLAYER_STORAGE_KEY, serialize(DEFAULT_PREFERENCES))

      const { attach, persist, options } = mountPreferences()
      const store = createFakeStore()

      options.getQuality.mockReturnValue(null)
      attach(createPlayer(store))
      store.setVolume(0.9)
      store.notify()
      persist()

      expect(readStored()).toMatchObject({
        volume: 0.9,
        quality: 1080,
        qualityChosen: true,
      })
    })

    it('keeps a legacy unflagged quality unchosen without quality options',
      () => {
        storage.setItem(VIDEO_PLAYER_STORAGE_KEY, serialize({
          ...DEFAULT_PREFERENCES,
          quality: 720,
          qualityChosen: undefined,
        }))

        const { attach, persist, options } = mountPreferences()
        const store = createFakeStore()

        options.getQuality.mockReturnValue(null)
        attach(createPlayer(store))
        store.setVolume(0.9)
        store.notify()
        persist()

        expect(readStored()).toMatchObject({
          volume: 0.9,
          quality: 720,
          qualityChosen: false,
        })
      })

    it('stores a null quality when nothing was ever saved', () => {
      const { attach, options } = mountPreferences()
      const store = createFakeStore()

      options.getQuality.mockReturnValue(null)
      attach(createPlayer(store))

      expect(readStored()).toMatchObject({
        quality: null,
        qualityChosen: false,
      })
    })

    it('prefers the live quality over the saved one', () => {
      storage.setItem(VIDEO_PLAYER_STORAGE_KEY, serialize(DEFAULT_PREFERENCES))

      const { attach, persist, options } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      options.getQuality.mockReturnValue(360)
      persist()

      expect(readStored()).toMatchObject({ quality: 360, qualityChosen: true })
    })

    it('flags a legacy unflagged quality as chosen once the user picks one',
      () => {
        storage.setItem(VIDEO_PLAYER_STORAGE_KEY, serialize({
          ...DEFAULT_PREFERENCES,
          quality: 720,
          qualityChosen: undefined,
        }))

        const { attach, persist, options } = mountPreferences()

        options.getQuality.mockReturnValue(null)
        attach(createPlayer(createFakeStore()))
        options.getQuality.mockReturnValue(720)
        persist()

        expect(readStored()).toMatchObject({
          quality: 720,
          qualityChosen: true,
        })
      })
  })

  describe('saved quality for the starting rendition', () => {
    it('returns a deliberately chosen quality', () => {
      storage.setItem(VIDEO_PLAYER_STORAGE_KEY, serialize(DEFAULT_PREFERENCES))

      expect(mountPreferences().readSavedQuality()).toBe(1080)
    })

    it.each([
      ['no flag', { qualityChosen: undefined }],
      ['a false flag', { qualityChosen: false }],
    ])('returns null for a quality saved with %s', (_label, overrides) => {
      storage.setItem(VIDEO_PLAYER_STORAGE_KEY, serialize({
        ...DEFAULT_PREFERENCES,
        quality: 720,
        ...overrides,
      }))

      expect(mountPreferences().readSavedQuality()).toBeNull()
    })

    it('returns null when nothing is stored', () => {
      expect(mountPreferences().readSavedQuality()).toBeNull()
    })
  })

  describe('restoring', () => {
    beforeEach(() => {
      storage.setItem(VIDEO_PLAYER_STORAGE_KEY, serialize(DEFAULT_PREFERENCES))
    })

    it('applies saved speed, quality, volume and mute', () => {
      const { attach, options } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))

      expect(options.applySpeed).toHaveBeenCalledWith(1.5)
      expect(options.applyQuality).toHaveBeenCalledWith(1080)
      expect(store.setVolume).toHaveBeenCalledWith(0.4)
      expect(store.setMuted).toHaveBeenCalledWith(true)
    })

    it('keeps restoring volume, mute and speed from a legacy record', () => {
      storage.setItem(VIDEO_PLAYER_STORAGE_KEY, serialize({
        ...DEFAULT_PREFERENCES,
        quality: 720,
        qualityChosen: undefined,
      }))

      const { attach, options } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))

      expect(options.applySpeed).toHaveBeenCalledWith(1.5)
      expect(options.applyQuality).not.toHaveBeenCalled()
      expect(store.setVolume).toHaveBeenCalledWith(0.4)
      expect(store.setMuted).toHaveBeenCalledWith(true)
    })

    it('skips quality when none was saved and mute when it was off', () => {
      storage.setItem(VIDEO_PLAYER_STORAGE_KEY, serialize({
        ...DEFAULT_PREFERENCES,
        quality: null,
        muted: false,
      }))

      const { attach, options } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))

      expect(options.applyQuality).not.toHaveBeenCalled()
      expect(store.setMuted).not.toHaveBeenCalled()
    })

    it('ignores corrupt saved preferences', () => {
      storage.setItem(VIDEO_PLAYER_STORAGE_KEY, '{not json')

      const { attach, options } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))

      expect(options.applySpeed).not.toHaveBeenCalled()
      expect(store.setVolume).not.toHaveBeenCalled()
    })

    it('waits for the store to attach to the media', () => {
      const { attach, options } = mountPreferences()
      const store = createFakeStore({ target: null })

      attach(createPlayer(store))

      expect(options.applySpeed).not.toHaveBeenCalled()
      expect(storage.getItem(VIDEO_PLAYER_STORAGE_KEY))
        .toBe(serialize(DEFAULT_PREFERENCES))

      store.target = {}
      store.notify()

      expect(options.applySpeed).toHaveBeenCalledWith(1.5)
    })

    it('restores only once', () => {
      const { attach, options } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      store.notify()
      store.notify()

      expect(options.applySpeed).toHaveBeenCalledTimes(1)
      expect(store.setVolume).toHaveBeenCalledTimes(1)
    })

    it('survives a storage that throws on read', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('storage blocked')
        },
        setItem: vi.fn(),
        removeItem: vi.fn(),
      })

      const { attach, options } = mountPreferences()
      const store = createFakeStore()

      expect(() => {
        attach(createPlayer(store))
      }).not.toThrow()
      expect(options.applySpeed).not.toHaveBeenCalled()
    })
  })

  describe('captions', () => {
    const englishTrack: FakeTextTrack = {
      id: 'track-en',
      kind: 'captions',
      language: 'en',
      mode: 'disabled',
    }
    const ukrainianTrack: FakeTextTrack = {
      id: 'track-uk',
      kind: 'subtitles',
      language: 'uk',
      mode: 'disabled',
    }
    const chaptersTrack: FakeTextTrack = {
      id: 'track-chapters',
      kind: 'chapters',
      language: 'en',
      mode: 'hidden',
    }

    function saveCaptions(captions: unknown) {
      storage.setItem(VIDEO_PLAYER_STORAGE_KEY, serialize({
        ...DEFAULT_PREFERENCES,
        captions,
      }))
    }

    it('selects the saved caption language once the tracks arrive', () => {
      saveCaptions({ enabled: true, language: 'uk' })

      const { attach } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))

      expect(store.selectSubtitlesTrack).not.toHaveBeenCalled()

      store.textTrackList = [chaptersTrack, englishTrack, ukrainianTrack]
      store.notify()

      expect(store.selectSubtitlesTrack)
        .toHaveBeenCalledExactlyOnceWith('track-uk')
    })

    it('selects the first caption track when no language was saved', () => {
      saveCaptions({ enabled: true, language: null })

      const { attach } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      store.textTrackList = [chaptersTrack, englishTrack, ukrainianTrack]
      store.notify()

      expect(store.selectSubtitlesTrack)
        .toHaveBeenCalledExactlyOnceWith('track-en')
    })

    it('leaves captions off when they were saved as off', () => {
      saveCaptions({ enabled: false, language: 'en' })

      const { attach } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      store.textTrackList = [englishTrack]
      store.notify()

      expect(store.selectSubtitlesTrack).not.toHaveBeenCalled()
    })

    it('selects nothing when the saved language has no track', () => {
      saveCaptions({ enabled: true, language: 'fr' })

      const { attach } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      store.textTrackList = [englishTrack]
      store.notify()

      expect(store.selectSubtitlesTrack).not.toHaveBeenCalled()
    })

    it('ignores non-caption tracks when restoring', () => {
      saveCaptions({ enabled: true, language: null })

      const { attach } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      store.textTrackList = [chaptersTrack]
      store.notify()

      expect(store.selectSubtitlesTrack).not.toHaveBeenCalled()
    })

    it('restores captions only once', () => {
      saveCaptions({ enabled: true, language: 'en' })

      const { attach } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      store.textTrackList = [englishTrack]
      store.notify()
      store.notify()

      expect(store.selectSubtitlesTrack).toHaveBeenCalledTimes(1)
    })

    it('keeps the saved captions choice while no track list exists', () => {
      saveCaptions({ enabled: true, language: 'uk' })

      const { attach } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      store.setVolume(0.9)
      store.notify()

      expect(readStored()).toMatchObject({
        volume: 0.9,
        captions: { enabled: true, language: 'uk' },
      })
    })

    it('persists the showing caption track', () => {
      const { attach } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      store.textTrackList = [
        { ...englishTrack, mode: 'showing' },
        ukrainianTrack,
      ]
      store.notify()

      expect(readStored()?.captions)
        .toEqual({ enabled: true, language: 'en' })
    })

    it('persists captions as off when no track is showing', () => {
      const { attach } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      store.textTrackList = [englishTrack]
      store.notify()

      expect(readStored()?.captions)
        .toEqual({ enabled: false, language: null })
    })
  })

  describe('persisting', () => {
    it('does not rewrite identical preferences', () => {
      const setItem = vi.spyOn(storage, 'setItem')
      const { attach } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      store.notify()
      store.notify()

      expect(setItem).toHaveBeenCalledTimes(1)
    })

    it('writes again when a stored value changes', () => {
      const setItem = vi.spyOn(storage, 'setItem')
      const { attach } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      store.setVolume(0.5)
      store.notify()

      expect(setItem).toHaveBeenCalledTimes(2)
      expect(readStored()?.volume).toBe(0.5)
    })

    it('persists the latest speed and quality on demand', () => {
      const { attach, persist, options } = mountPreferences()

      attach(createPlayer(createFakeStore()))
      options.getQuality.mockReturnValue(360)
      options.getSpeed.mockReturnValue(2)
      persist()

      expect(readStored()).toMatchObject({ quality: 360, speed: 2 })
    })

    it('does nothing before a player is attached', () => {
      const { persist } = mountPreferences()

      persist()

      expect(storage.getItem(VIDEO_PLAYER_STORAGE_KEY)).toBeNull()
    })

    it('survives a storage that throws on write', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          return null
        },
        setItem: () => {
          throw new Error('quota exceeded')
        },
        removeItem: vi.fn(),
      })

      const { attach } = mountPreferences()

      expect(() => {
        attach(createPlayer(createFakeStore()))
      }).not.toThrow()
    })
  })

  describe('lifecycle', () => {
    it('subscribes to the store once', () => {
      const { attach } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      attach(createPlayer(store))

      expect(store.subscribe).toHaveBeenCalledTimes(1)
    })

    it('unsubscribes when the scope is disposed', () => {
      const { attach } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      scope.stop()

      expect(store.unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('stops reacting to store changes after detach', () => {
      const { attach, detach } = mountPreferences()
      const store = createFakeStore()

      attach(createPlayer(store))
      detach()
      store.setVolume(0.1)
      store.notify()

      expect(readStored()?.volume).toBe(1)
    })
  })
})
