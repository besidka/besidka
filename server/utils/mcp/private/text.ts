export const MCP_TRUNCATION_MARKER = '\n[…truncated]'

export interface TruncatedText {
  text: string
  truncated: boolean
}

const HIGH_SURROGATE_START = 0xD800
const HIGH_SURROGATE_END = 0xDBFF

function isHighSurrogate(code: number): boolean {
  return code >= HIGH_SURROGATE_START && code <= HIGH_SURROGATE_END
}

export function truncateMcpText(text: string, maxChars: number): TruncatedText {
  if (text.length <= maxChars) {
    return { text, truncated: false }
  }

  const limit = Math.max(0, maxChars - MCP_TRUNCATION_MARKER.length)
  const keep = isHighSurrogate(text.charCodeAt(limit - 1)) ? limit - 1 : limit

  return {
    text: `${text.slice(0, keep)}${MCP_TRUNCATION_MARKER}`,
    truncated: true,
  }
}

export function toIsoTimestamp(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}
