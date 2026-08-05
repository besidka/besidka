interface ParsedUserAgent {
  browser: string
  os: string
}

const osPatterns: [RegExp, string][] = [
  [/iphone|ipad|ipod/i, 'iOS'],
  [/android/i, 'Android'],
  [/mac os x/i, 'macOS'],
  [/windows/i, 'Windows'],
  [/linux/i, 'Linux'],
]

const browserPatterns: [RegExp, string][] = [
  [/edg\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/crios/i, 'Chrome'],
  [/fxios/i, 'Firefox'],
  [/chrome/i, 'Chrome'],
  [/firefox/i, 'Firefox'],
  [/safari/i, 'Safari'],
]

function matchPattern(
  value: string,
  patterns: [RegExp, string][],
): string | null {
  const match = patterns.find(([pattern]) => pattern.test(value))

  return match ? match[1]! : null
}

export function parseUserAgent(userAgent?: string | null): ParsedUserAgent {
  if (!userAgent) {
    return {
      browser: 'Unknown browser',
      os: 'Unknown device',
    }
  }

  return {
    browser: matchPattern(userAgent, browserPatterns) || 'Unknown browser',
    os: matchPattern(userAgent, osPatterns) || 'Unknown device',
  }
}

export function describeUserAgent(userAgent?: string | null): string {
  const { browser, os } = parseUserAgent(userAgent)

  if (browser === 'Unknown browser' && os === 'Unknown device') {
    return 'Unknown device'
  }

  return `${browser} on ${os}`
}
