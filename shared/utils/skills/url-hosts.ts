import type { SkillFindingSeverity } from '#shared/utils/skills/findings'

export interface RiskyHostEntry {
  hosts: readonly string[]
  pathPrefix?: string
  severity: Extract<SkillFindingSeverity, 'high' | 'medium'>
  kind: string
}

export interface SkillUrlClassification {
  rule: string
  severity: SkillFindingSeverity
  detail: string
}

/**
 * Hosts that receive whatever is sent to them: webhooks, request catchers,
 * tunnels and out-of-band testing servers are high; paste sites, file drops,
 * dynamic DNS and link shorteners are medium. A host matches itself and every
 * subdomain of it.
 */
export const RISKY_HOSTS: readonly RiskyHostEntry[] = [
  {
    hosts: ['discord.com', 'discordapp.com'],
    pathPrefix: '/api/webhooks',
    severity: 'high',
    kind: 'webhook host',
  },
  { hosts: ['hooks.slack.com'], severity: 'high', kind: 'webhook host' },
  {
    hosts: ['api.telegram.org'],
    pathPrefix: '/bot',
    severity: 'high',
    kind: 'webhook host',
  },
  {
    hosts: ['webhook.site', 'requestbin.com', 'requestbin.net', 'pipedream.net'],
    severity: 'high',
    kind: 'request catcher host',
  },
  {
    hosts: [
      'ngrok.io',
      'ngrok.app',
      'ngrok.dev',
      'ngrok-free.app',
      'ngrok-free.dev',
      'trycloudflare.com',
    ],
    severity: 'high',
    kind: 'tunnel host',
  },
  {
    hosts: [
      'interact.sh',
      'oast.fun',
      'oast.live',
      'oast.me',
      'oast.online',
      'oast.pro',
      'oast.site',
      'burpcollaborator.net',
      'beeceptor.com',
    ],
    severity: 'high',
    kind: 'out-of-band testing host',
  },
  {
    hosts: [
      'pastebin.com',
      'paste.ee',
      'hastebin.com',
      'transfer.sh',
      '0x0.st',
      'file.io',
    ],
    severity: 'medium',
    kind: 'paste or file drop host',
  },
  {
    hosts: ['duckdns.org', 'ddns.net'],
    severity: 'medium',
    kind: 'dynamic DNS host',
  },
  {
    hosts: [
      'bit.ly',
      'tinyurl.com',
      'is.gd',
      'cutt.ly',
      'rb.gy',
      't.co',
      'ow.ly',
      'shorturl.at',
      'tiny.cc',
      'rebrand.ly',
    ],
    severity: 'medium',
    kind: 'link shortener',
  },
]

const SCRIPT_OR_ARCHIVE_PATTERN = /\.(?:sh|ps1|py|exe|zip|7z|dmg|pkg)$/
const IPV4_HOST_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/
const PUNYCODE_LABEL_PATTERN = /(?:^|\.)xn--/
const LOOPBACK_HOST_PATTERN = /^(?:127\.|\[::1\]$)/
const PRIVATE_IPV4_PATTERN
  = /^(?:0\.|10\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/
const PRIVATE_IPV6_PATTERN = /^\[(?:::\]|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i

const SEVERITY_RANK: Record<SkillFindingSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

function hostMatches(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`)
}

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl)
  } catch {
    return null
  }
}

function findRiskyHostEntry(url: URL): RiskyHostEntry | null {
  const hostname = url.hostname.toLowerCase()

  return RISKY_HOSTS.find((entry) => {
    return entry.hosts.some((host) => {
      return hostMatches(hostname, host)
    }) && (
      !entry.pathPrefix
      || url.pathname.toLowerCase().startsWith(entry.pathPrefix)
    )
  }) ?? null
}

/**
 * The entry of the risky host list that a link points at, or null. The host
 * is read after `new URL()`, so odd spellings of the same host are caught.
 */
export function findRiskyHost(rawUrl: string): RiskyHostEntry | null {
  const url = parseUrl(rawUrl)

  return url ? findRiskyHostEntry(url) : null
}

function isIpLiteral(hostname: string): boolean {
  return IPV4_HOST_PATTERN.test(hostname) || hostname.startsWith('[')
}

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_IPV4_PATTERN.test(hostname)
    || PRIVATE_IPV6_PATTERN.test(hostname)
}

/**
 * What is worth saying about where a link goes, most important first: a
 * webhook, tunnel or out-of-band host (high), an IP address (high when it is
 * private, medium otherwise, loopback included, because a skill that talks
 * to a local development server is common), an international host name, a
 * paste, dynamic DNS or shortener host, a link to a script or archive
 * (medium), plain `http:` or a non-standard port (low). A link with nothing
 * to say gives null.
 */
export function classifySkillUrl(
  rawUrl: string,
): SkillUrlClassification | null {
  const url = parseUrl(rawUrl)

  if (!url) {
    return null
  }

  const hostname = url.hostname.toLowerCase()
  const candidates: SkillUrlClassification[] = []
  const riskyHost = findRiskyHostEntry(url)

  if (riskyHost) {
    candidates.push({
      rule: 'url-risky-host',
      severity: riskyHost.severity,
      detail: `${riskyHost.kind}: ${hostname}`,
    })
  }

  if (isIpLiteral(hostname)) {
    const isPrivate = isPrivateHost(hostname)
    const isLoopback = LOOPBACK_HOST_PATTERN.test(hostname)

    candidates.push({
      rule: 'url-ip-address',
      severity: isPrivate ? 'high' : 'medium',
      detail: isPrivate
        ? `private IP address: ${hostname}`
        : isLoopback
          ? `loopback IP address: ${hostname}`
          : `IP address: ${hostname}`,
    })
  }

  if (PUNYCODE_LABEL_PATTERN.test(hostname)) {
    candidates.push({
      rule: 'url-international-host',
      severity: 'medium',
      detail: `international host name: ${hostname}`,
    })
  }

  if (SCRIPT_OR_ARCHIVE_PATTERN.test(url.pathname.toLowerCase())) {
    candidates.push({
      rule: 'url-script-link',
      severity: 'medium',
      detail: `link to a script or archive: ${hostname}`,
    })
  }

  if (url.protocol === 'http:') {
    candidates.push({
      rule: 'url-plain-http',
      severity: 'low',
      detail: `plain http: ${hostname}`,
    })
  }

  if (url.port !== '') {
    candidates.push({
      rule: 'url-odd-port',
      severity: 'low',
      detail: `port ${url.port}: ${hostname}`,
    })
  }

  return candidates.sort((left, right) => {
    return SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
  })[0] ?? null
}
