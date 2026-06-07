import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import DemoVideo from '../../../../app/components/landing/DemoVideo.vue'

describe('DemoVideo.vue', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('$fetch', fetchMock)
  })

  it('renders the video player when there is no error', async () => {
    const wrapper = await mountSuspended(DemoVideo, {
      props: { src: '/videos/demo.mp4' },
    })

    expect(wrapper.find('video').exists()).toBe(true)
  })

  it('hides the player after an error event', async () => {
    const wrapper = await mountSuspended(DemoVideo, {
      props: { src: '/videos/demo.mp4' },
    })

    expect(wrapper.find('video').exists()).toBe(true)

    await wrapper.find('video').trigger('error')

    expect(wrapper.find('video').exists()).toBe(false)
  })

  it('tracks video_play only once on repeated play events', async () => {
    const wrapper = await mountSuspended(DemoVideo, {
      props: { src: '/videos/demo.mp4' },
    })

    const video = wrapper.find('video')

    await video.trigger('play')
    await video.trigger('play')
    await video.trigger('play')

    const videoCalls = fetchMock.mock.calls.filter(
      call => call[1]?.body?.event === 'video_play',
    )

    expect(videoCalls).toHaveLength(1)
    expect(videoCalls[0][1].body).toMatchObject({
      event: 'video_play',
      target: 'demo',
    })
  })

  it('tracks video_complete on ended event', async () => {
    const wrapper = await mountSuspended(DemoVideo, {
      props: { src: '/videos/demo.mp4' },
    })

    await wrapper.find('video').trigger('ended')

    const completedCalls = fetchMock.mock.calls.filter(
      call => call[1]?.body?.event === 'video_complete',
    )

    expect(completedCalls).toHaveLength(1)
    expect(completedCalls[0][1].body).toMatchObject({
      event: 'video_complete',
      target: 'demo',
    })
  })
})
