import ipaddr from 'ipaddr.js'
import {
  CONNECTOR_ALLOWED_PORTS,
  CONNECTOR_URL_MAX_LENGTH,
} from '#shared/utils/connectors-policy'
import { isOwnHostname } from '~~/server/utils/net/own-hosts'

export const SAFE_URL_REJECTIONS = [
  'length',
  'characters',
  'invalid',
  'scheme',
  'credentials',
  'ip-literal',
  'special-name',
  'own-host',
  'port',
  'path',
] as const

export type SafeUrlRejection = typeof SAFE_URL_REJECTIONS[number]

export type SafeUrlResult
  = | { ok: true, url: URL }
    | { ok: false, reason: SafeUrlRejection, range?: string }

export interface SafeUrlOptions {
  allowPath?: boolean
}

export interface IpClassification {
  allowed: boolean
  range: string
  embedded?: string
}

const DEFAULT_HTTPS_PORT = 443
const GLOBAL_UNICAST_IPV6_FIRST_BYTE_MASK = 0xe0
const GLOBAL_UNICAST_IPV6_FIRST_BYTE = 0x20
const WHITESPACE = /\s/
const LAST_C0_CONTROL = 0x1f
const FIRST_DELETE_OR_C1_CONTROL = 0x7f
const LAST_C1_CONTROL = 0x9f
const SPECIAL_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.localdomain',
  '.lan',
  '.home',
  '.corp',
  '.intranet',
] as const
const SPECIAL_HOSTS: readonly string[] = [
  'localhost',
  'local',
  'home.arpa',
  'metadata.google.internal',
]

function classifyIpv4(address: ipaddr.IPv4): IpClassification {
  const range = address.range()

  return { allowed: range === 'unicast', range }
}

function classifyIpv6(address: ipaddr.IPv6): IpClassification {
  const range = address.range()

  if (range === 'ipv4Mapped') {
    const inner = classifyIpv4(address.toIPv4Address())

    return { ...inner, embedded: 'ipv4Mapped' }
  }

  if (range !== 'unicast') {
    return { allowed: false, range }
  }

  const [firstByte = 0] = address.toByteArray()
  const isGlobalUnicast
    = (firstByte & GLOBAL_UNICAST_IPV6_FIRST_BYTE_MASK)
      === GLOBAL_UNICAST_IPV6_FIRST_BYTE

  return {
    allowed: isGlobalUnicast,
    range: isGlobalUnicast ? range : 'non-global',
  }
}

/**
 * Whether an address may be reached. Only global unicast passes: every
 * special range the parser names (unspecified, loopback, private, link-local,
 * unique-local, carrier-grade NAT, multicast, broadcast, reserved, 6to4,
 * Teredo, NAT64 and the other transition ranges) is refused, so a range the
 * parser learns later is refused by default. IPv4-mapped IPv6 is judged by
 * its inner IPv4 address. An unparsable address is refused.
 */
export function classifyIp(address: string): IpClassification {
  const bare = address.replace(/^\[|\]$/g, '')

  if (!ipaddr.isValid(bare)) {
    return { allowed: false, range: 'invalid' }
  }

  const parsed = ipaddr.parse(bare)

  return parsed.kind() === 'ipv4'
    ? classifyIpv4(parsed as ipaddr.IPv4)
    : classifyIpv6(parsed as ipaddr.IPv6)
}

function hasControlOrWhitespace(value: string): boolean {
  if (WHITESPACE.test(value)) {
    return true
  }

  for (const character of value) {
    const codePoint = character.codePointAt(0)!

    if (
      codePoint <= LAST_C0_CONTROL
      || (
        codePoint >= FIRST_DELETE_OR_C1_CONTROL
        && codePoint <= LAST_C1_CONTROL
      )
    ) {
      return true
    }
  }

  return false
}

function isSpecialHostname(hostname: string): boolean {
  if (!hostname.includes('.')) {
    return true
  }

  if (SPECIAL_HOSTS.includes(hostname)) {
    return true
  }

  return SPECIAL_HOST_SUFFIXES.some((suffix) => {
    return hostname.endsWith(suffix)
  })
}

function hasEmptyLabel(hostname: string): boolean {
  if (hostname === '') {
    return true
  }

  if (hostname.startsWith('[')) {
    return false
  }

  return hostname.split('.').some((label) => {
    return label === ''
  })
}

function isIpLiteralHostname(hostname: string): boolean {
  return hostname.startsWith('[') || ipaddr.IPv4.isValid(hostname)
}

function reject(
  reason: SafeUrlRejection,
  range?: string,
): SafeUrlResult {
  return range === undefined
    ? { ok: false, reason }
    : { ok: false, reason, range }
}

/**
 * The one gate for every URL Besidka fetches on a user's, a model's or a
 * remote server's behalf. Pure: no request, no DNS. The WHATWG parser has
 * already normalized decimal, octal and hex IPv4 forms and punycoded IDN
 * hosts before the checks look at the host.
 */
export function parseSafeOutboundUrl(
  input: string,
  options: SafeUrlOptions = {},
): SafeUrlResult {
  const trimmed = input.trim()

  if (trimmed.length > CONNECTOR_URL_MAX_LENGTH) {
    return reject('length')
  }

  if (hasControlOrWhitespace(trimmed)) {
    return reject('characters')
  }

  let url: URL

  try {
    url = new URL(trimmed)
  } catch {
    return reject('invalid')
  }

  if (url.protocol !== 'https:') {
    return reject('scheme')
  }

  if (url.username !== '' || url.password !== '') {
    return reject('credentials')
  }

  const strippedHostname = url.hostname.toLowerCase().replace(/\.$/, '')

  if (hasEmptyLabel(strippedHostname)) {
    return reject('invalid')
  }

  url.hostname = strippedHostname
  url.hash = ''

  const hostname = url.hostname.toLowerCase()

  if (hostname !== strippedHostname) {
    return reject('invalid')
  }

  if (isIpLiteralHostname(hostname)) {
    const { range } = classifyIp(hostname)

    return reject('ip-literal', range)
  }

  if (isSpecialHostname(hostname)) {
    return reject('special-name')
  }

  if (isOwnHostname(hostname)) {
    return reject('own-host')
  }

  const port = url.port === '' ? DEFAULT_HTTPS_PORT : Number(url.port)

  if (!CONNECTOR_ALLOWED_PORTS.includes(port)) {
    return reject('port')
  }

  if (options.allowPath === false && (url.pathname !== '/' || url.search)) {
    return reject('path')
  }

  return { ok: true, url }
}
