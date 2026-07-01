import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWakeLock } from '../../../app/composables/wake-lock'

describe('useWakeLock', () => {
  let visibilityHandler: (() => void) | null = null
  let wakeLockRequest: ReturnType<typeof vi.fn>
  let sentinelRelease: ReturnType<typeof vi.fn>
  let videoPlay: ReturnType<typeof vi.fn>
  let videoPause: ReturnType<typeof vi.fn>

  beforeEach(() => {
    visibilityHandler = null

    sentinelRelease = vi.fn().mockResolvedValue(undefined)
    wakeLockRequest = vi.fn().mockResolvedValue({ release: sentinelRelease })

    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: wakeLockRequest },
    })

    videoPlay = vi.fn().mockResolvedValue(undefined)
    videoPause = vi.fn()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(videoPlay)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(videoPause)

    vi.spyOn(document, 'addEventListener').mockImplementation((type, handler) => {
      if (type === 'visibilitychange') {
        visibilityHandler = handler as () => void
      }
    })
    vi.spyOn(document, 'removeEventListener').mockImplementation(() => {})
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('plays the video fallback synchronously before awaiting the native request', async () => {
    const wakeLock = useWakeLock()
    const acquirePromise = wakeLock.acquire()

    expect(videoPlay).toHaveBeenCalledTimes(1)

    await acquirePromise

    expect(wakeLockRequest).toHaveBeenCalledWith('screen')
    expect(wakeLock.isActive.value).toBe(true)

    await wakeLock.release()
  })

  it('does not request the native lock twice while already active', async () => {
    const wakeLock = useWakeLock()

    await wakeLock.acquire()
    await wakeLock.acquire()

    expect(wakeLockRequest).toHaveBeenCalledTimes(1)

    await wakeLock.release()
  })

  it('releases the native sentinel and pauses the video fallback', async () => {
    const wakeLock = useWakeLock()

    await wakeLock.acquire()
    await wakeLock.release()

    expect(sentinelRelease).toHaveBeenCalledTimes(1)
    expect(videoPause).toHaveBeenCalledTimes(1)
    expect(wakeLock.isActive.value).toBe(false)
  })

  it('re-primes both mechanisms on visibilitychange while still active', async () => {
    const wakeLock = useWakeLock()

    await wakeLock.acquire()
    wakeLockRequest.mockClear()
    videoPlay.mockClear()

    visibilityHandler?.()
    await Promise.resolve()

    expect(videoPlay).toHaveBeenCalledTimes(1)
    expect(wakeLockRequest).toHaveBeenCalledTimes(1)

    await wakeLock.release()
  })

  it('ignores visibilitychange after release', async () => {
    const wakeLock = useWakeLock()

    await wakeLock.acquire()
    await wakeLock.release()
    wakeLockRequest.mockClear()
    videoPlay.mockClear()

    visibilityHandler?.()
    await Promise.resolve()

    expect(videoPlay).not.toHaveBeenCalled()
    expect(wakeLockRequest).not.toHaveBeenCalled()
  })

  it('still plays the video fallback when the native API is unsupported', async () => {
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: undefined,
    })

    const wakeLock = useWakeLock()

    await wakeLock.acquire()

    expect(videoPlay).toHaveBeenCalledTimes(1)
    expect(wakeLock.isActive.value).toBe(true)

    await wakeLock.release()
  })

  it('still plays the video fallback when the native API rejects', async () => {
    wakeLockRequest.mockRejectedValue(new Error('denied'))

    const wakeLock = useWakeLock()

    await wakeLock.acquire()

    expect(videoPlay).toHaveBeenCalledTimes(1)
    expect(wakeLock.isActive.value).toBe(true)

    await wakeLock.release()
  })

  it('still plays the video fallback when the native API exists but silently no-ops', async () => {
    // Reproduces WebKit bug 254545: the native API resolves successfully but
    // the screen still sleeps in an installed standalone PWA on iOS < 18.4.
    // There is no way to detect this from script, so the fallback must run
    // unconditionally rather than only when native is detected unsupported.
    const wakeLock = useWakeLock()

    await wakeLock.acquire()

    expect(wakeLockRequest).toHaveBeenCalledTimes(1)
    expect(videoPlay).toHaveBeenCalledTimes(1)

    await wakeLock.release()
  })
})
