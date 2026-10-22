import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import type { VideoPlayerElement } from '@videojs/html/video'
import {
  installVideoPlayerEnvironment,
  waitForPlayerReady,
} from '../../../setup/helpers/video-player'
import VideoShell from '../../../../app/components/Video/Shell.vue'

const PLAYER_TIMEOUT_MS = 15000
const ATTACH_TIMEOUT_MS = 4000

const QUALITIES = [
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
]
const SPEEDS = [
  { value: '1', label: 'Normal' },
  { value: '2', label: '2×' },
]

const FULL_ONLY_TEST_IDS = [
  'video-time',
  'video-volume-slider',
  'video-captions-button',
  'video-settings-button',
  'video-settings-menu',
  'video-airplay-button',
]

const SHARED_TEST_IDS = [
  'video-player',
  'video-big-play',
  'video-play-button',
  'video-time-slider',
  'video-mute-button',
  'video-pip-button',
  'video-fullscreen-button',
]

enableAutoUnmount(afterEach)

async function mountShell(
  props: Record<string, unknown> = {},
  slots: { includeVideo?: boolean } = { includeVideo: true },
) {
  return await mountSuspended(VideoShell, {
    props,
    slots: {
      default: () => {
        return slots.includeVideo === false
          ? h('p', { 'data-testid': 'shell-default-slot' }, 'slot content')
          : h('video', {
            'data-testid': 'video-media',
            'src': '/videos/demo.mp4',
          })
      },
      overlay: () => {
        return h('div', { 'data-testid': 'shell-overlay-slot' })
      },
    },
    attachTo: document.body,
  })
}

function has(wrapper: VueWrapper, testId: string): boolean {
  return wrapper.find(`[data-testid="${testId}"]`).exists()
}

function getPlayer(wrapper: VueWrapper): VideoPlayerElement {
  return wrapper.get('video-player').element as VideoPlayerElement
}

function readPoster(wrapper: VueWrapper): string | null | undefined {
  const element = wrapper.get('video-player').element as HTMLElement & {
    poster?: string
  }

  return element.poster ?? element.getAttribute('poster')
}

function dispatchValueChange(
  wrapper: VueWrapper,
  testId: string,
  detail: unknown,
) {
  wrapper.get(`[data-testid="${testId}"]`).element.dispatchEvent(
    new CustomEvent('value-change', { detail }),
  )
}

describe('Video/Shell', () => {
  beforeEach(() => {
    installVideoPlayerEnvironment()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('variants', () => {
    it('renders the full control set by default', async () => {
      const wrapper = await mountShell()

      await waitForPlayerReady(wrapper)

      for (const testId of [...SHARED_TEST_IDS, ...FULL_ONLY_TEST_IDS]) {
        expect(has(wrapper, testId), testId).toBe(true)
      }
    }, PLAYER_TIMEOUT_MS)

    it('hides settings, volume, captions, time and AirPlay when lean',
      async () => {
        const wrapper = await mountShell({ variant: 'lean' })

        await waitForPlayerReady(wrapper)

        for (const testId of SHARED_TEST_IDS) {
          expect(has(wrapper, testId), testId).toBe(true)
        }

        for (const testId of FULL_ONLY_TEST_IDS) {
          expect(has(wrapper, testId), testId).toBe(false)
        }
      })

    it('limits the lean hotkeys to playback, seek, mute, fullscreen and PiP',
      async () => {
        const full = await mountShell()

        await waitForPlayerReady(full)

        const lean = await mountShell({ variant: 'lean' })

        await waitForPlayerReady(lean)

        function readActions(wrapper: VueWrapper): string[] {
          return wrapper.findAll('media-hotkey').map((hotkey) => {
            const element = hotkey.element as HTMLElement & {
              action?: string
            }

            return element.action ?? element.getAttribute('action') ?? ''
          })
        }

        const fullActions = readActions(full)
        const leanActions = readActions(lean)

        expect(fullActions).toContain('toggleSubtitles')
        expect(fullActions).toContain('volumeStep')
        expect(leanActions).not.toContain('toggleSubtitles')
        expect(leanActions).not.toContain('volumeStep')
        expect(leanActions).toEqual(expect.arrayContaining([
          'togglePaused',
          'toggleMuted',
          'seekStep',
          'seekToPercent',
          'toggleFullscreen',
          'togglePictureInPicture',
        ]))
      })
  })

  describe('slots and props', () => {
    it('renders the default slot inside the container and the overlay '
      + 'slot after the controls', async () => {
      const wrapper = await mountShell()

      await waitForPlayerReady(wrapper)

      const container = wrapper.get('[data-testid="video-player"]').element

      expect(container.contains(
        wrapper.get('[data-testid="video-media"]').element,
      )).toBe(true)
      expect(container.contains(
        wrapper.get('[data-testid="shell-overlay-slot"]').element,
      )).toBe(true)
    })

    it('forwards the container class', async () => {
      const wrapper = await mountShell({ containerClass: 'js-custom-hook' })

      expect(wrapper.get('[data-testid="video-player"]').classes())
        .toContain('js-custom-hook')
    })

    it('leaves the poster to the slotted video element', async () => {
      const wrapper = await mountShell()

      expect(readPoster(wrapper)).toBeFalsy()
    })
  })

  describe('ready signal', () => {
    it('emits ready with the player element and the time slider',
      async () => {
        const wrapper = await mountShell()

        await waitForPlayerReady(wrapper)

        const [payload] = wrapper.emitted('ready')![0] as [{
          player: VideoPlayerElement
          timeSlider: HTMLElement | null
        }]

        expect(wrapper.emitted('ready')).toHaveLength(1)
        expect(payload.player).toBe(getPlayer(wrapper))
        expect(payload.player.store.target).toBeTruthy()
        expect(payload.timeSlider).toBe(
          wrapper.get('[data-testid="video-time-slider"]').element,
        )
        expect(wrapper.emitted('failed')).toBeUndefined()
      })

    it('emits ready after the attach timeout when no media appears',
      async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

        const wrapper = await mountShell({}, { includeVideo: false })

        await vi.advanceTimersByTimeAsync(ATTACH_TIMEOUT_MS - 1)

        expect(wrapper.emitted('ready')).toBeUndefined()

        await vi.advanceTimersByTimeAsync(1)
        await flushPromises()

        expect(wrapper.emitted('ready')).toHaveLength(1)
      })

    it('emits neither ready nor failed when unmounted while loading',
      async () => {
        let resolveDefined: () => void = () => {}

        vi.spyOn(customElements, 'whenDefined').mockReturnValue(
          new Promise<CustomElementConstructor>((resolve) => {
            resolveDefined = () => {
              resolve(HTMLElement as unknown as CustomElementConstructor)
            }
          }),
        )

        const wrapper = await mountShell()

        wrapper.unmount()
        resolveDefined()
        await flushPromises()

        expect(wrapper.emitted('ready')).toBeUndefined()
        expect(wrapper.emitted('failed')).toBeUndefined()
      })

    it('does not emit failed when unmounted before a failure settles',
      async () => {
        let rejectDefined: (reason: Error) => void = () => {}

        vi.spyOn(customElements, 'whenDefined').mockReturnValue(
          new Promise<CustomElementConstructor>((_resolve, reject) => {
            rejectDefined = reject
          }),
        )

        const wrapper = await mountShell()

        wrapper.unmount()
        rejectDefined(new Error('late failure'))
        await flushPromises()

        expect(wrapper.emitted('failed')).toBeUndefined()
      })
  })

  describe('failure fallback', () => {
    it('emits failed and renders no custom controls when the elements '
      + 'are not defined', async () => {
      vi.spyOn(customElements, 'whenDefined')
        .mockRejectedValue(new Error('elements failed'))

      const wrapper = await mountShell()

      await flushPromises()

      expect(wrapper.emitted('failed')).toHaveLength(1)
      expect(wrapper.emitted('ready')).toBeUndefined()
      expect(has(wrapper, 'video-media')).toBe(true)
      expect(has(wrapper, 'shell-overlay-slot')).toBe(true)

      for (const testId of SHARED_TEST_IDS.filter((id) => {
        return id !== 'video-player'
      })) {
        expect(has(wrapper, testId), testId).toBe(false)
      }
    })

    it('emits failed when the elements module fails to import', async () => {
      vi.doMock('~/utils/videojs-elements', () => {
        throw new Error('chunk failed to load')
      })

      try {
        const wrapper = await mountShell()

        await flushPromises()

        expect(wrapper.emitted('failed')).toHaveLength(1)
        expect(wrapper.emitted('ready')).toBeUndefined()
      } finally {
        vi.doUnmock('~/utils/videojs-elements')
      }
    })
  })

  describe('custom menus', () => {
    it('hides the quality menu with fewer than two qualities', async () => {
      const wrapper = await mountShell({
        qualities: [QUALITIES[0]],
        speeds: SPEEDS,
        selectedSpeed: '1',
      })

      await waitForPlayerReady(wrapper)

      expect(has(wrapper, 'video-settings-quality')).toBe(false)
      expect(has(wrapper, 'video-quality-options')).toBe(false)
      expect(has(wrapper, 'video-settings-speed')).toBe(true)
    })

    it('renders quality and speed options with the selected labels',
      async () => {
        const wrapper = await mountShell({
          qualities: QUALITIES,
          selectedQuality: '720',
          speeds: SPEEDS,
          selectedSpeed: '2',
        })

        await waitForPlayerReady(wrapper)

        expect(has(wrapper, 'video-quality-1080')).toBe(true)
        expect(has(wrapper, 'video-quality-720')).toBe(true)
        expect(has(wrapper, 'video-speed-1')).toBe(true)
        expect(has(wrapper, 'video-speed-2')).toBe(true)
        expect(wrapper.get('[data-testid="video-settings-quality"]').text())
          .toContain('720p')
        expect(wrapper.get('[data-testid="video-settings-speed"]').text())
          .toContain('2×')
      })

    it('emits selectQuality and selectSpeed from menu value changes',
      async () => {
        const wrapper = await mountShell({
          qualities: QUALITIES,
          selectedQuality: '720',
          speeds: SPEEDS,
          selectedSpeed: '1',
        })

        await waitForPlayerReady(wrapper)

        dispatchValueChange(wrapper, 'video-quality-options', {
          value: '1080',
        })
        dispatchValueChange(wrapper, 'video-speed-options', { value: '2' })

        expect(wrapper.emitted('selectQuality')).toEqual([['1080']])
        expect(wrapper.emitted('selectSpeed')).toEqual([['2']])
      })

    it('ignores menu value changes without a string value', async () => {
      const wrapper = await mountShell({
        qualities: QUALITIES,
        selectedQuality: '720',
        speeds: SPEEDS,
        selectedSpeed: '1',
      })

      await waitForPlayerReady(wrapper)

      dispatchValueChange(wrapper, 'video-quality-options', { value: 1080 })
      dispatchValueChange(wrapper, 'video-quality-options', null)
      dispatchValueChange(wrapper, 'video-speed-options', {})

      expect(wrapper.emitted('selectQuality')).toBeUndefined()
      expect(wrapper.emitted('selectSpeed')).toBeUndefined()
    })
  })

  describe('settings availability', () => {
    it('keeps the settings button visible without caption tracks',
      async () => {
        const wrapper = await mountShell({
          qualities: QUALITIES,
          selectedQuality: '720',
          speeds: SPEEDS,
          selectedSpeed: '1',
        })

        await waitForPlayerReady(wrapper)

        expect(wrapper.find('track[kind="captions"]').exists()).toBe(false)

        const trigger = wrapper.get('[data-testid="video-settings-button"]')

        expect(trigger.element.hasAttribute('hidden')).toBe(false)
        expect(has(wrapper, 'video-settings-menu')).toBe(true)
      })

    it('keeps the settings button visible with only the speed menu',
      async () => {
        const wrapper = await mountShell({
          speeds: SPEEDS,
          selectedSpeed: '1',
        })

        await waitForPlayerReady(wrapper)

        expect(wrapper.get('[data-testid="video-settings-button"]')
          .element.hasAttribute('hidden')).toBe(false)
      })

    it('relies on a radio-group publishMenuOptionState method that still '
      + 'exists', async () => {
      const wrapper = await mountShell({ speeds: SPEEDS })

      await waitForPlayerReady(wrapper)

      const radioGroup = customElements.get('media-menu-radio-group')

      expect(radioGroup).toBeDefined()
      expect(typeof radioGroup?.prototype.publishMenuOptionState)
        .toBe('function')
    })

    function getOptionGroups(wrapper: VueWrapper) {
      return wrapper.findAll([
        '[data-testid="video-quality-options"]',
        '[data-testid="video-speed-options"]',
      ].join(', ')).map((group) => {
        return group.element as HTMLElement & {
          publishMenuOptionState?: (...args: unknown[]) => void
        }
      })
    }

    it('publishes the available state on each custom option group',
      async () => {
        const wrapper = await mountShell({
          qualities: QUALITIES,
          selectedQuality: '720',
          speeds: SPEEDS,
          selectedSpeed: '1',
        })

        await waitForPlayerReady(wrapper)

        const groups = getOptionGroups(wrapper)

        expect(groups).toHaveLength(2)

        const spies = groups.map((group) => {
          return vi.spyOn(group, 'publishMenuOptionState')
        })

        await wrapper.setProps({ selectedSpeed: '2' })
        await flushPromises()

        for (const spy of spies) {
          expect(spy).toHaveBeenCalledWith(false, false, 'available')
        }
      })

    it('does not throw when publishMenuOptionState is missing', async () => {
      const wrapper = await mountShell({
        qualities: QUALITIES,
        selectedQuality: '720',
        speeds: SPEEDS,
        selectedSpeed: '1',
      })

      await waitForPlayerReady(wrapper)

      for (const group of getOptionGroups(wrapper)) {
        Object.defineProperty(group, 'publishMenuOptionState', {
          configurable: true,
          value: undefined,
        })
      }

      await wrapper.setProps({ selectedSpeed: '2' })
      await flushPromises()

      expect(has(wrapper, 'video-settings-button')).toBe(true)
    })
  })

  describe('controls hover lock', () => {
    function getControlBar(wrapper: VueWrapper): Element {
      return wrapper.get('.video-controls__bar').element
    }

    async function mountWithLockSpy() {
      const wrapper = await mountShell()

      await waitForPlayerReady(wrapper)

      const release = vi.fn()
      const requestControlsLock = vi.fn(() => {
        return release
      })
      const player = getPlayer(wrapper)
      const realStore = player.store

      Object.defineProperty(player, 'store', {
        configurable: true,
        value: new Proxy(realStore, {
          get: (target, property) => {
            return property === 'requestControlsLock'
              ? requestControlsLock
              : Reflect.get(target, property)
          },
        }),
      })

      return { wrapper, release, requestControlsLock }
    }

    it('holds a controls lock while the mouse hovers the control bar',
      async () => {
        const { wrapper, release, requestControlsLock }
          = await mountWithLockSpy()
        const bar = getControlBar(wrapper)

        bar.dispatchEvent(
          new PointerEvent('pointerenter', { pointerType: 'mouse' }),
        )
        bar.dispatchEvent(
          new PointerEvent('pointerenter', { pointerType: 'mouse' }),
        )

        expect(requestControlsLock).toHaveBeenCalledTimes(1)
        expect(release).not.toHaveBeenCalled()

        bar.dispatchEvent(
          new PointerEvent('pointerleave', { pointerType: 'mouse' }),
        )

        expect(release).toHaveBeenCalledTimes(1)
      })

    it('does not lock the controls for touch pointers', async () => {
      const { wrapper, requestControlsLock } = await mountWithLockSpy()

      getControlBar(wrapper).dispatchEvent(
        new PointerEvent('pointerenter', { pointerType: 'touch' }),
      )

      expect(requestControlsLock).not.toHaveBeenCalled()
    })

    it('releases a held lock when unmounted', async () => {
      const { wrapper, release } = await mountWithLockSpy()

      getControlBar(wrapper).dispatchEvent(
        new PointerEvent('pointerenter', { pointerType: 'mouse' }),
      )
      wrapper.unmount()

      expect(release).toHaveBeenCalledTimes(1)
    })
  })
})
