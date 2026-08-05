import { describe, expect, it } from 'vitest'
import { describeUserAgent, parseUserAgent } from '../../../app/utils/user-agent'

describe('parseUserAgent', () => {
  it('identifies Chrome on macOS', () => {
    const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
      + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

    expect(parseUserAgent(userAgent)).toEqual({
      browser: 'Chrome',
      os: 'macOS',
    })
  })

  it('identifies Safari on iOS', () => {
    const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) '
      + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 '
      + 'Safari/604.1'

    expect(parseUserAgent(userAgent)).toEqual({
      browser: 'Safari',
      os: 'iOS',
    })
  })

  it('identifies Firefox on Windows', () => {
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) '
      + 'Gecko/20100101 Firefox/120.0'

    expect(parseUserAgent(userAgent)).toEqual({
      browser: 'Firefox',
      os: 'Windows',
    })
  })

  it('identifies Edge before falling back to Chrome', () => {
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
      + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 '
      + 'Edg/120.0.0.0'

    expect(parseUserAgent(userAgent).browser).toBe('Edge')
  })

  it('falls back to unknown labels for a missing user agent', () => {
    expect(parseUserAgent(null)).toEqual({
      browser: 'Unknown browser',
      os: 'Unknown device',
    })
    expect(parseUserAgent(undefined)).toEqual({
      browser: 'Unknown browser',
      os: 'Unknown device',
    })
  })
})

describe('describeUserAgent', () => {
  it('combines browser and OS into a single label', () => {
    const userAgent = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

    expect(describeUserAgent(userAgent)).toBe('Chrome on Android')
  })

  it('describes a missing user agent as an unknown device', () => {
    expect(describeUserAgent(null)).toBe('Unknown device')
  })
})
