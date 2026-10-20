import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'
import { useVideoWatchAnalytics } from '../../../app/composables/video-watch-analytics'

const mocks = vi.hoisted(() => {
  return { track: vi.fn() }
})

mockNuxtImport('useLandingAnalytics', () => {
  return () => {
    return { track: mocks.track }
  }
})

type Watch = ReturnType<typeof useVideoWatchAnalytics>

function playFor(
  watch: Watch,
  seconds: number,
  options: { from?: number, step?: number, duration?: number } = {},
) {
  const { from = 0, step = 0.25, duration = 60 } = options

  for (let elapsed = step; elapsed <= seconds + 1e-9; elapsed += step) {
    watch.update(from + elapsed, duration)
  }
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

function lastPayload(): Record<string, unknown> {
  return mocks.track.mock.calls.at(-1)![1]
}

describe('useVideoWatchAnalytics', () => {
  beforeEach(() => {
    mocks.track.mockReset()
    setVisibility('visible')
  })

  afterEach(() => {
    setVisibility('visible')
  })

  it('accumulates played time from timeupdate deltas', () => {
    const watch = useVideoWatchAnalytics(() => 'google')

    watch.start('user', 0)
    playFor(watch, 5)
    watch.end('pause')

    expect(mocks.track).toHaveBeenCalledExactlyOnceWith(
      'video_watch',
      {
        target: 'google',
        value: 5,
        trigger: 'user',
        watchedSeconds: 5,
        durationSeconds: 60,
        completionPercent: 8,
        endReason: 'pause',
      },
      { keepalive: false },
    )
  })

  it('reads the target when the session ends', () => {
    let target = 'google'
    const watch = useVideoWatchAnalytics(() => target)

    watch.start('user', 0)
    playFor(watch, 2)
    target = 'openai'
    watch.end('pause')

    expect(lastPayload().target).toBe('openai')
  })

  it('ignores seek jumps above 1.5 seconds', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('user', 0)
    playFor(watch, 3)
    watch.update(40, 60)
    playFor(watch, 2, { from: 40 })
    watch.end('pause')

    expect(lastPayload()).toMatchObject({
      watchedSeconds: 5,
      completionPercent: 70,
    })
  })

  it('ignores backward seeks and loop restarts', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('user', 0)
    playFor(watch, 3, { duration: 4 })
    watch.update(0, 4)
    playFor(watch, 2, { duration: 4 })
    watch.end('pause')

    expect(lastPayload()).toMatchObject({
      watchedSeconds: 4,
      completionPercent: 75,
    })
  })

  it('keeps the highest position reached for completionPercent', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('user', 0)
    playFor(watch, 30, { duration: 40 })
    watch.update(5, 40)
    watch.end('pause')

    expect(lastPayload().completionPercent).toBe(75)
  })

  it('caps watchedSeconds at the duration', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('user', 0)

    for (let loop = 0; loop < 3; loop++) {
      playFor(watch, 4, { duration: 4 })
      watch.update(0, 4)
    }

    watch.end('pause')

    expect(lastPayload()).toMatchObject({
      watchedSeconds: 4,
      durationSeconds: 4,
      completionPercent: 100,
    })
  })

  it('reports 100 percent when playback ends', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('user', 0)
    playFor(watch, 3, { duration: 3.5 })
    watch.end('ended')

    expect(lastPayload()).toMatchObject({
      endReason: 'ended',
      completionPercent: 100,
    })
  })

  it('does not send anything below one watched second', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('user', 0)
    playFor(watch, 0.75)
    watch.end('pause')

    expect(mocks.track).not.toHaveBeenCalled()
  })

  it('sends at the one second threshold', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('user', 0)
    playFor(watch, 1)
    watch.end('pause')

    expect(mocks.track).toHaveBeenCalledTimes(1)
  })

  it('sends once per segment and ignores a second end call', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('user', 0)
    playFor(watch, 3)
    watch.end('pause')
    watch.end('pause')
    watch.end('unmount')

    expect(mocks.track).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh session after a pause', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('autoplay', 0)
    playFor(watch, 3)
    watch.end('pause')

    watch.start('user', 3)
    playFor(watch, 2, { from: 3 })
    watch.end('pause')

    expect(mocks.track).toHaveBeenCalledTimes(2)
    expect(mocks.track.mock.calls[0]![1]).toMatchObject({
      trigger: 'autoplay',
      watchedSeconds: 3,
    })
    expect(mocks.track.mock.calls[1]![1]).toMatchObject({
      trigger: 'user',
      watchedSeconds: 2,
    })
  })

  it('keeps the trigger of the play that started the session', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('autoplay', 0)
    watch.start('user', 0)
    playFor(watch, 2)
    watch.end('pause')

    expect(lastPayload().trigger).toBe('autoplay')
  })

  it('upgrades an autoplay session to user once', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('autoplay', 0)

    expect(watch.upgradeToUser()).toBe(true)
    expect(watch.upgradeToUser()).toBe(false)

    playFor(watch, 2)
    watch.end('pause')

    expect(lastPayload().trigger).toBe('user')
  })

  it('does not upgrade when no session is active', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    expect(watch.upgradeToUser()).toBe(false)
  })

  it('ignores updates when no session is active', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    playFor(watch, 5)
    watch.end('pause')

    expect(mocks.track).not.toHaveBeenCalled()
  })

  it('rounds seconds to a tenth', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('user', 0)
    playFor(watch, 2.4, { step: 0.4, duration: 61.26 })
    watch.end('pause')

    expect(lastPayload()).toMatchObject({
      watchedSeconds: 2.4,
      value: 2.4,
      durationSeconds: 61.3,
    })
  })

  it('reports zero completion when the duration is unknown', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('user', 0)
    playFor(watch, 3, { duration: Number.NaN })
    watch.end('pause')

    expect(lastPayload()).toMatchObject({
      watchedSeconds: 3,
      durationSeconds: 0,
      completionPercent: 0,
    })
  })

  it('uses keepalive for hidden and unmount only', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    for (const reason of ['pause', 'ended', 'hidden', 'unmount'] as const) {
      watch.start('user', 0)
      playFor(watch, 2)
      watch.end(reason)
    }

    const keepalives = mocks.track.mock.calls.map((call) => {
      return call[2].keepalive
    })

    expect(keepalives).toEqual([false, false, true, true])
  })

  it('ends the session when the page becomes hidden', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('user', 0)
    playFor(watch, 3)
    setVisibility('hidden')

    expect(mocks.track).toHaveBeenCalledExactlyOnceWith(
      'video_watch',
      expect.objectContaining({ endReason: 'hidden', watchedSeconds: 3 }),
      { keepalive: true },
    )
  })

  it('ends the session on pagehide and does not double send', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('user', 0)
    playFor(watch, 3)
    window.dispatchEvent(new Event('pagehide'))
    setVisibility('hidden')

    expect(mocks.track).toHaveBeenCalledTimes(1)
    expect(lastPayload().endReason).toBe('hidden')
  })

  it('resumes a new session when playback continues after hidden', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('autoplay', 0)
    playFor(watch, 3)
    setVisibility('hidden')
    playFor(watch, 5, { from: 3 })
    setVisibility('visible')
    playFor(watch, 2, { from: 8 })
    watch.end('pause')

    expect(mocks.track).toHaveBeenCalledTimes(2)
    expect(mocks.track.mock.calls[1]![1]).toMatchObject({
      trigger: 'autoplay',
      watchedSeconds: 1.8,
      endReason: 'pause',
    })
  })

  it('does not resume after a pause that follows hidden', () => {
    const watch = useVideoWatchAnalytics(() => 'demo')

    watch.start('user', 0)
    playFor(watch, 3)
    setVisibility('hidden')
    watch.end('pause')
    setVisibility('visible')
    playFor(watch, 3, { from: 3 })
    watch.end('pause')

    expect(mocks.track).toHaveBeenCalledTimes(1)
  })

  it('sends on unmount with keepalive', async () => {
    let watch: Watch | undefined

    const Probe = defineComponent({
      setup() {
        watch = useVideoWatchAnalytics(() => 'google')

        return () => h('div')
      },
    })

    const wrapper = await mountSuspended(Probe)

    watch!.start('user', 0)
    playFor(watch!, 3)
    wrapper.unmount()

    expect(mocks.track).toHaveBeenCalledExactlyOnceWith(
      'video_watch',
      expect.objectContaining({ target: 'google', endReason: 'unmount' }),
      { keepalive: true },
    )
  })

  it('stops listening to the page after unmount', async () => {
    let watch: Watch | undefined

    const Probe = defineComponent({
      setup() {
        watch = useVideoWatchAnalytics(() => 'google')

        return () => h('div')
      },
    })

    const wrapper = await mountSuspended(Probe)

    wrapper.unmount()
    watch!.start('user', 0)
    playFor(watch!, 3)
    setVisibility('hidden')

    expect(mocks.track).not.toHaveBeenCalled()
  })
})
