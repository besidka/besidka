export function getAllowedHosts(baseUrl: string): string[] {
  if (!baseUrl) {
    return []
  }

  const url = new URL(baseUrl)
  const host = url.host
  const hostname = url.hostname

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return [host, 'localhost:*', '127.0.0.1:*']
  }

  const parts = hostname.split('.')
  const twoPartDomain = parts.slice(-2).join('.')

  if (hostname === twoPartDomain) {
    return [host, `www.${hostname}`]
  }

  if (hostname === `www.${twoPartDomain}`) {
    return [host, twoPartDomain]
  }

  const subdomain = parts[0]
  const rest = parts.slice(1).join('.')

  return [host, `*-${subdomain}.${rest}`]
}

/**
 * WebAuthn requires the relying-party ID to equal the origin's effective
 * domain, or be a registrable-domain suffix of it that is not itself a
 * public suffix (browsers reject a bare public suffix as an RP ID, since it
 * would let unrelated tenants of a shared domain share a WebAuthn scope).
 * Stripping only a leading `www.` satisfies both constraints for every host
 * this app serves: apex and `www` intentionally share credentials in
 * production, while every other host — including multi-label public
 * suffixes such as `*.workers.dev` — keeps its full hostname, which trivially
 * equals the effective domain and can never be a bare public suffix.
 */
export function getRelyingPartyId(baseUrl: string): string {
  if (!baseUrl) {
    return 'localhost'
  }

  const hostname = new URL(baseUrl).hostname

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'localhost'
  }

  if (hostname.startsWith('www.')) {
    return hostname.slice('www.'.length)
  }

  return hostname
}
