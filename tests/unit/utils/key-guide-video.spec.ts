import { afterEach, describe, expect, it, vi } from 'vitest'
import { canAutoplayGuideVideo } from '../../../app/utils/key-guide-video'

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => {
    return {
      matches: query === '(prefers-reduced-motion: reduce)' && matches,
    }
  }))
}

function stubConnection(connection: { saveData?: boolean } | undefined) {
  Object.defineProperty(navigator, 'connection', {
    value: connection,
    configurable: true,
  })
}

describe('canAutoplayGuideVideo', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    stubConnection(undefined)
  })

  it('allows autoplay by default', () => {
    stubReducedMotion(false)
    stubConnection(undefined)

    expect(canAutoplayGuideVideo()).toBe(true)
  })

  it('blocks autoplay when the user prefers reduced motion', () => {
    stubReducedMotion(true)

    expect(canAutoplayGuideVideo()).toBe(false)
  })

  it('blocks autoplay when data saver is on', () => {
    stubReducedMotion(false)
    stubConnection({ saveData: true })

    expect(canAutoplayGuideVideo()).toBe(false)
  })

  it('allows autoplay when the connection reports data saver off', () => {
    stubReducedMotion(false)
    stubConnection({ saveData: false })

    expect(canAutoplayGuideVideo()).toBe(true)
  })
})
