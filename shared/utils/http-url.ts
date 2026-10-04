const HTTP_URL_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

/**
 * True only for an absolute `http:` or `https:` URL. Search result URLs come
 * from third-party content, so anything else (`javascript:`, `data:`,
 * `file:`, a relative or unparsable string) must not become a clickable
 * source.
 */
export function isHttpUrl(value: string): boolean {
  try {
    return HTTP_URL_PROTOCOLS.has(new URL(value).protocol)
  } catch {
    return false
  }
}
