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
