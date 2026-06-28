import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import VideoPlayer
  from '../../../../app/components/landing/VideoPlayer.client.vue'

interface FakeInstance {
  emit: (event: string) => void
  destroyed: boolean
}

const mocks = vi.hoisted(() => {
  return {
    track: vi.fn(),
    generate: vi.fn(),
    instances: [] as FakeInstance[],
    lastOptions: null as Record<string, unknown> | null,
    shouldThrow: false,
  }
})

vi.mock('plyr', () => {
  class FakePlyr {
    handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
    source: unknown = null
    destroyed = false

    constructor(_element: unknown, options: unknown) {
      if (mocks.shouldThrow) {
        throw new Error('plyr init failed')
      }

      mocks.lastOptions = options as Record<string, unknown>
      mocks.instances.push(this as unknown as FakeInstance)
    }

    on(event: string, callback: (...args: unknown[]) => void) {
      (this.handlers[event] ||= []).push(callback)
    }

    emit(event: string) {
      (this.handlers[event] || []).forEach((callback) => {
        return callback()
      })
    }

    destroy() {
      this.destroyed = true
    }
  }

  return { default: FakePlyr }
})

mockNuxtImport('useLandingAnalytics', () => {
  return () => {
    return { track: mocks.track }
  }
})

mockNuxtImport('useLandingVideoThumbnails', () => {
  return () => {
    return { generate: mocks.generate }
  }
})

describe('VideoPlayer.client.vue', () => {
  beforeEach(() => {
    mocks.track.mockReset()
    mocks.generate.mockReset().mockResolvedValue(null)
    mocks.instances.length = 0
    mocks.lastOptions = null
    mocks.shouldThrow = false
  })

  it('builds options with parsed markers and a sorted quality ladder',
    async () => {
      await mountSuspended(VideoPlayer, {
        props: {
          src: '/videos/demo.mp4',
          qualities: [
            { src: '/videos/demo-1080.mp4', size: 1080 },
            { src: '/videos/demo.mp4', size: 720 },
            { src: '/videos/demo-360.mp4', size: 360 },
          ],
          markers: [
            { time: '0:08', label: 'End' },
            { time: '0:02', label: 'Start' },
          ],
          thumbnails: false,
        },
      })

      await flushPromises()

      expect(mocks.instances).toHaveLength(1)

      const options = mocks.lastOptions as Record<string, never>

      expect(options.quality).toMatchObject({
        default: 720,
        options: [1080, 720, 360],
      })
      expect(options.markers).toMatchObject({
        enabled: true,
        points: [
          { time: 2, label: 'Start' },
          { time: 8, label: 'End' },
        ],
      })
    })

  it('tracks video_play once and video_complete on ended', async () => {
    await mountSuspended(VideoPlayer, {
      props: { src: '/videos/demo.mp4', thumbnails: false },
    })

    await flushPromises()

    const player = mocks.instances[0]!

    player.emit('play')
    player.emit('play')
    player.emit('ended')

    const playCalls = mocks.track.mock.calls.filter((call) => {
      return call[0] === 'video_play'
    })

    expect(playCalls).toHaveLength(1)
    expect(mocks.track).toHaveBeenCalledWith('video_play', { target: 'demo' })
    expect(mocks.track).toHaveBeenCalledWith(
      'video_complete',
      { target: 'demo' },
    )
  })

  it('requests thumbnail generation from the default-quality source',
    async () => {
      await mountSuspended(VideoPlayer, {
        props: {
          src: '/videos/demo.mp4',
          qualities: [
            { src: '/videos/demo-1080.mp4', size: 1080 },
            { src: '/videos/demo.mp4', size: 720 },
          ],
          thumbnails: true,
        },
      })

      await flushPromises()

      expect(mocks.generate).toHaveBeenCalledWith(
        '/videos/demo.mp4',
        { count: 12 },
      )
    })

  it('skips thumbnail generation when disabled', async () => {
    await mountSuspended(VideoPlayer, {
      props: { src: '/videos/demo.mp4', thumbnails: false },
    })

    await flushPromises()

    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('falls back to native controls when Plyr throws', async () => {
    mocks.shouldThrow = true

    const wrapper = await mountSuspended(VideoPlayer, {
      props: { src: '/videos/demo.mp4', thumbnails: false },
    })

    await flushPromises()

    expect(mocks.instances).toHaveLength(0)
    expect(wrapper.find('video').element.controls).toBe(true)
  })
})
