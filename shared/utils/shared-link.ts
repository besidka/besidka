const sharedChatPathPattern
  = /\/shared\/([0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26})(?![0-9A-Za-z])/

export function extractSharedChatPath(text: string): string | null {
  if (!text) {
    return null
  }

  const match = sharedChatPathPattern.exec(text)

  if (!match || !match[1]) {
    return null
  }

  return `/shared/${match[1].toUpperCase()}`
}
