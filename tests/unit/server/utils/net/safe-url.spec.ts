import { describe, expect, it } from 'vitest'
import {
  SAFE_URL_REJECTIONS,
  classifyIp,
  parseSafeOutboundUrl,
} from '~~/server/utils/net/safe-url'

function expectRejected(input: string, reason: string) {
  const result = parseSafeOutboundUrl(input)

  expect(result, input).toEqual(expect.objectContaining({
    ok: false,
    reason,
  }))
}

function expectAccepted(input: string, expected: string) {
  const result = parseSafeOutboundUrl(input)

  expect(result.ok, input).toBe(true)

  if (result.ok) {
    expect(result.url.toString()).toBe(expected)
  }
}

describe('parseSafeOutboundUrl', () => {
  describe('scheme', () => {
    it.each([
      'http://example.com',
      'http://example.com:443',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ftp://example.com',
      'wss://example.com',
      'data:text/plain,hello',
      'blob:https://example.com/uuid',
    ])('rejects %s', (input) => {
      expectRejected(input, 'scheme')
    })

    it('rejects a scheme in upper case after normalization', () => {
      expectRejected('HTTP://example.com', 'scheme')
    })
  })

  describe('IP literals in every form', () => {
    it.each([
      'https://127.0.0.1',
      'https://0x7f.0.0.1',
      'https://0177.0.0.1',
      'https://2130706433',
      'https://127.1',
      'https://0.0.0.0',
      'https://0',
      'https://0x7f000001',
      'https://017700000001',
      'https://127.0.0.1.',
      'https://%31%32%37.0.0.1',
      'https://①②⑦.0.0.1',
      'https://１２７.０.０.１',
      'https://169.254.169.254/latest/meta-data',
      'https://100.64.0.1',
      'https://224.0.0.1',
      'https://255.255.255.255',
      'https://10.0.0.1',
      'https://172.16.0.1',
      'https://192.168.1.1',
      'https://8.8.8.8',
      'https://1.1.1.1:8443/mcp',
      'https://3232235777',
    ])('rejects IPv4 %s', (input) => {
      expectRejected(input, 'ip-literal')
    })

    it.each([
      'https://[::1]',
      'https://[::]',
      'https://[::ffff:127.0.0.1]',
      'https://[::ffff:7f00:1]',
      'https://[::ffff:8.8.8.8]',
      'https://[0:0:0:0:0:ffff:7f00:1]',
      'https://[::127.0.0.1]',
      'https://[fe80::1]',
      'https://[fc00::1]',
      'https://[fd12::1]',
      'https://[ff02::1]',
      'https://[2002:7f00:1::]',
      'https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]',
      'https://[64:ff9b::7f00:1]',
      'https://[2001:db8::1]',
      'https://[2606:4700::1111]',
    ])('rejects IPv6 %s', (input) => {
      expectRejected(input, 'ip-literal')
    })

    it('reports the range of a rejected literal for logs', () => {
      const cases: Array<[string, string]> = [
        ['https://127.0.0.1', 'loopback'],
        ['https://169.254.169.254', 'linkLocal'],
        ['https://10.0.0.1', 'private'],
        ['https://100.64.0.1', 'carrierGradeNat'],
        ['https://[fd12::1]', 'uniqueLocal'],
        ['https://[::1]', 'loopback'],
        ['https://[::ffff:7f00:1]', 'loopback'],
      ]

      for (const [input, range] of cases) {
        expect(parseSafeOutboundUrl(input), input).toEqual({
          ok: false,
          reason: 'ip-literal',
          range,
        })
      }
    })

    it('rejects an IPv6 zone identifier as an invalid address', () => {
      expectRejected('https://[fe80::1%25eth0]', 'invalid')
    })

    it('rejects a user-info trick that hides an IP host', () => {
      expectRejected('https://example.com@127.0.0.1/', 'credentials')
    })
  })

  describe('special names', () => {
    it.each([
      'https://localhost',
      'https://LOCALHOST',
      'https://localhost.',
      'https://foo.localhost',
      'https://a.b.localhost',
      'https://printer.local',
      'https://local',
      'https://metadata.google.internal',
      'https://metadata.google.internal.',
      'https://db.internal',
      'https://router.home.arpa',
      'https://home.arpa',
      'https://intranet',
      'https://server.localdomain',
      'https://nas.lan',
      'https://wiki.corp',
    ])('rejects %s', (input) => {
      expectRejected(input, 'special-name')
    })

    it('does not reject hosts that merely contain a special word', () => {
      expectAccepted(
        'https://localhost.example.com/mcp',
        'https://localhost.example.com/mcp',
      )
      expectAccepted(
        'https://internal.example.com/mcp',
        'https://internal.example.com/mcp',
      )
      expectAccepted(
        'https://notlocal.example.org/mcp',
        'https://notlocal.example.org/mcp',
      )
    })
  })

  describe('empty labels and repeated trailing dots', () => {
    it.each([
      'https://127.0.0.1../',
      'https://127.0.0.1.%2e/',
      'https://127.0.0.1%2e%2e/',
      'https://169.254.169.254../latest/meta-data',
      'https://localhost../',
      'https://localhost.%2e/',
      'https://metadata.google.internal../',
      'https://example.com../',
      'https://example..com/',
      'https://.example.com/',
      'https://example.com.%2e/',
    ])('rejects %s', (input) => {
      const result = parseSafeOutboundUrl(input)

      expect(result.ok, input).toBe(false)
    })

    it.each([
      'https://127.0.0.1../',
      'https://localhost../',
      'https://metadata.google.internal../',
    ])('never lets %s become an accepted URL', (input) => {
      const result = parseSafeOutboundUrl(input)

      expect(result).toEqual({ ok: false, reason: 'invalid' })
    })
  })

  describe('normalization is a fixed point', () => {
    const inputs = [
      'https://mcp.notion.com/mcp',
      'https://EXAMPLE.com./path#frag',
      'https://bücher.example/mcp',
      'https://example.com:443/mcp',
      'https://example.com:8443/mcp?x=1#y',
      'https://example.com./',
      '  https://example.com/a  ',
      'https://127.0.0.1../',
      'https://localhost../',
      'https://127.0.0.1.%2e/',
      'https://example.com../',
      'https://a.b.c.d.example.com/',
      'https://xn--bcher-kva.example/',
      'https://EXAMPLE.COM/',
      'https://example.com\\path',
    ]

    it.each(inputs)('accepts or rejects %j and re-parses identically', (input) => {
      const first = parseSafeOutboundUrl(input)

      if (!first.ok) {
        return
      }

      const second = parseSafeOutboundUrl(first.url.toString())

      expect(second.ok, input).toBe(true)

      if (second.ok) {
        expect(second.url.toString()).toBe(first.url.toString())
      }
    })

    it('never accepts a host that classifies as an address or a special name', () => {
      const hosts = [
        '127.0.0.1', '127.0.0.1.', '127.0.0.1..', 'localhost', 'localhost.',
        'localhost..', 'a.localhost', 'a.localhost.', 'metadata.google.internal',
        'metadata.google.internal.', '169.254.169.254', '169.254.169.254.',
        '0x7f.1', '2130706433', '[::1]', '[::ffff:7f00:1]',
      ]
      const suffixes = ['', '.', '..', '%2e', '.%2e', '%2e%2e']

      for (const host of hosts) {
        for (const suffix of suffixes) {
          const result = parseSafeOutboundUrl(`https://${host}${suffix}/p`)

          if (result.ok) {
            const reparsed = new URL(result.url.toString())

            expect(reparsed.hostname, `${host}${suffix}`).not.toMatch(
              /^(\[.*\]|\d+\.\d+\.\d+\.\d+|localhost\.?|.*\.localhost\.?|metadata\.google\.internal\.?)$/,
            )
          }
        }
      }
    })
  })

  describe('Besidka\'s own hosts', () => {
    it.each([
      'https://besidka.com/api/v1/chats',
      'https://BESIDKA.com./',
      'https://www.besidka.com/',
      'https://cdn.besidka.com/',
      'https://besidka.com:8443/',
      'https://besidka-artifacts.chernenko.workers.dev/',
      'https://pr-12-besidka.chernenko.workers.dev/mcp',
      'https://preview-besidka.chernenko.workers.dev/',
      'https://anything.chernenko.workers.dev/',
    ])('rejects %s', (input) => {
      expectRejected(input, 'own-host')
    })

    it('accepts look-alikes that are not Besidka\'s', () => {
      for (const input of [
        'https://notbesidka.com/mcp',
        'https://besidka.com.evil.example/mcp',
        'https://besidka.example.org/mcp',
        'https://chernenko.workers.dev.example.org/mcp',
        'https://other.workers.dev/mcp',
      ]) {
        expect(parseSafeOutboundUrl(input).ok, input).toBe(true)
      }
    })

    it('also rejects the hosts from the runtime configuration', () => {
      const config = useRuntimeConfig()
      const original = {
        authAdditionalAllowedHosts: config.authAdditionalAllowedHosts,
        baseUrl: config.public.baseUrl,
        artifactsOrigin: config.public.artifactsOrigin,
      }

      config.authAdditionalAllowedHosts = '*-app.example.org'
      config.public.baseUrl = 'https://app.example.org'
      config.public.artifactsOrigin = 'https://viewer.example.net'

      try {
        for (const input of [
          'https://app.example.org/x',
          'https://pr-9-app.example.org/x',
          'https://viewer.example.net/x',
        ]) {
          expectRejected(input, 'own-host')
        }

        expect(parseSafeOutboundUrl('https://mcp.example.org/x').ok)
          .toBe(true)
      } finally {
        config.authAdditionalAllowedHosts = original.authAdditionalAllowedHosts
        config.public.baseUrl = original.baseUrl
        config.public.artifactsOrigin = original.artifactsOrigin
      }
    })

    it('keeps the static names when the configuration is unusable', () => {
      const config = useRuntimeConfig()
      const original = config.public.baseUrl

      config.public.baseUrl = 'not a url'

      try {
        expectRejected('https://besidka.com/', 'own-host')
        expect(parseSafeOutboundUrl('https://example.com/').ok).toBe(true)
      } finally {
        config.public.baseUrl = original
      }
    })
  })

  describe('credentials', () => {
    it.each([
      'https://user:pass@example.com',
      'https://user@example.com',
      'https://:pass@example.com',
    ])('rejects %s', (input) => {
      expectRejected(input, 'credentials')
    })
  })

  describe('ports', () => {
    it.each([
      'https://example.com:22',
      'https://example.com:80',
      'https://example.com:8080',
      'https://example.com:444',
      'https://example.com:65535',
    ])('rejects %s', (input) => {
      expectRejected(input, 'port')
    })

    it('accepts the default port and 8443', () => {
      expectAccepted('https://example.com:443/mcp', 'https://example.com/mcp')
      expectAccepted(
        'https://example.com:8443/mcp',
        'https://example.com:8443/mcp',
      )
    })
  })

  describe('length and characters', () => {
    it('rejects a URL of 3000 characters', () => {
      expectRejected(`https://example.com/${'a'.repeat(3000)}`, 'length')
    })

    it('accepts a URL of exactly 2048 characters', () => {
      const prefix = 'https://example.com/'
      const input = `${prefix}${'a'.repeat(2048 - prefix.length)}`

      expect(input).toHaveLength(2048)
      expect(parseSafeOutboundUrl(input).ok).toBe(true)
    })

    it.each([
      'https://example.com/a\nb',
      'https://example.com/a\rb',
      'https://example.com/a\tb',
      'https://example.com/a b',
      'https://example.com/a\u0000b',
      'https://example.com/a\u007fb',
      'https://example.com/a\u0085b',
      'https://example.com/a b',
      'https://example.com/a b',
      'https://exa mple.com',
    ])('rejects %j', (input) => {
      expectRejected(input, 'characters')
    })

    it('trims leading and trailing whitespace before checking', () => {
      expectAccepted(
        '  https://mcp.notion.com/mcp\n',
        'https://mcp.notion.com/mcp',
      )
    })

    it.each(['', '   ', 'not a url', '//example.com', 'example.com/mcp'])(
      'rejects %j as invalid or with a bad character',
      (input) => {
        const result = parseSafeOutboundUrl(input)

        expect(result.ok).toBe(false)
      },
    )
  })

  describe('accepted addresses', () => {
    it.each([
      'https://mcp.notion.com/mcp',
      'https://mcp.linear.app/mcp',
      'https://api.githubcopilot.com/mcp/',
      'https://mcp.atlassian.com/v2/mcp',
    ])('leaves %s unchanged', (input) => {
      expectAccepted(input, input)
    })

    it('lowercases the host, strips the trailing dot and the fragment', () => {
      expectAccepted(
        'https://EXAMPLE.com./path#frag',
        'https://example.com/path',
      )
    })

    it('punycodes an IDN host', () => {
      expectAccepted(
        'https://bücher.example/mcp',
        'https://xn--bcher-kva.example/mcp',
      )
    })

    it('keeps a path and a query', () => {
      expectAccepted(
        'https://example.com/mcp?key=value',
        'https://example.com/mcp?key=value',
      )
    })

    it('treats a backslash like the parser does, so the host stays example.com', () => {
      const result = parseSafeOutboundUrl('https://example.com\\@evil.com/')

      expect(result.ok).toBe(true)

      if (result.ok) {
        expect(result.url.hostname).toBe('example.com')
      }
    })
  })

  describe('allowPath: false', () => {
    it('accepts an origin and rejects a path or a query', () => {
      expect(parseSafeOutboundUrl('https://example.com', {
        allowPath: false,
      }).ok).toBe(true)
      expect(parseSafeOutboundUrl('https://example.com/mcp', {
        allowPath: false,
      })).toEqual({ ok: false, reason: 'path' })
      expect(parseSafeOutboundUrl('https://example.com/?a=1', {
        allowPath: false,
      })).toEqual({ ok: false, reason: 'path' })
    })
  })

  describe('documented limit: DNS names', () => {
    it.each([
      'https://127.0.0.1.nip.io/mcp',
      'https://localtest.me/mcp',
      'https://10.0.0.1.sslip.io/mcp',
    ])('passes %s, because this check cannot resolve DNS', (input) => {
      expect(parseSafeOutboundUrl(input).ok).toBe(true)
    })
  })

  it('lists every rejection reason it can return', () => {
    expect([...SAFE_URL_REJECTIONS].sort()).toEqual([
      'characters',
      'credentials',
      'invalid',
      'ip-literal',
      'length',
      'own-host',
      'path',
      'port',
      'scheme',
      'special-name',
    ])
  })
})

describe('classifyIp', () => {
  it.each([
    ['0.0.0.0', 'unspecified'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.0.1', 'private'],
    ['169.254.169.254', 'linkLocal'],
    ['100.64.0.1', 'carrierGradeNat'],
    ['100.127.255.255', 'carrierGradeNat'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.255', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['192.0.2.1', 'reserved'],
    ['198.51.100.1', 'reserved'],
    ['198.18.0.1', 'reserved'],
    ['240.0.0.1', 'reserved'],
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['fe80::1', 'linkLocal'],
    ['fc00::1', 'uniqueLocal'],
    ['fdff::1', 'uniqueLocal'],
    ['ff02::1', 'multicast'],
    ['2002:7f00:1::', '6to4'],
    ['2001::1', 'teredo'],
    ['64:ff9b::7f00:1', 'rfc6052'],
    ['2001:db8::1', 'reserved'],
    ['100::1', 'discard'],
    ['fec0::1', 'deprecatedSiteLocal'],
  ])('blocks %s (%s)', (address, range) => {
    expect(classifyIp(address)).toEqual({ allowed: false, range })
  })

  it('blocks IPv4-mapped IPv6 by the inner address', () => {
    expect(classifyIp('::ffff:127.0.0.1')).toEqual({
      allowed: false,
      range: 'loopback',
      embedded: 'ipv4Mapped',
    })
    expect(classifyIp('::ffff:7f00:1')).toEqual(expect.objectContaining({
      allowed: false,
      range: 'loopback',
    }))
    expect(classifyIp('::ffff:10.0.0.1')).toEqual(expect.objectContaining({
      allowed: false,
      range: 'private',
    }))
    expect(classifyIp('::ffff:169.254.169.254')).toEqual(
      expect.objectContaining({ allowed: false, range: 'linkLocal' }),
    )
  })

  it('blocks the other IPv4 notations the parser understands', () => {
    expect(classifyIp('0x7f.0.0.1').allowed).toBe(false)
    expect(classifyIp('0177.0.0.1').allowed).toBe(false)
    expect(classifyIp('2130706433').allowed).toBe(false)
    expect(classifyIp('127.1').allowed).toBe(false)
  })

  it('accepts brackets around an IPv6 address', () => {
    expect(classifyIp('[::1]')).toEqual({ allowed: false, range: 'loopback' })
  })

  it('allows global unicast only', () => {
    expect(classifyIp('8.8.8.8')).toEqual({ allowed: true, range: 'unicast' })
    expect(classifyIp('1.1.1.1').allowed).toBe(true)
    expect(classifyIp('2606:4700:4700::1111').allowed).toBe(true)
    expect(classifyIp('2001:4860:4860::8888').allowed).toBe(true)
  })

  it('blocks an IPv6 unicast address outside 2000::/3', () => {
    expect(classifyIp('4000::1')).toEqual({
      allowed: false,
      range: 'non-global',
    })
  })

  it('judges a mapped address by its inner address only', () => {
    expect(classifyIp('::ffff:8.8.8.8')).toEqual({
      allowed: true,
      range: 'unicast',
      embedded: 'ipv4Mapped',
    })
  })

  it.each(['', 'example.com', '999.1.1.1', 'g::1', '1.2.3.4.5'])(
    'blocks the unparsable value %j',
    (address) => {
      expect(classifyIp(address)).toEqual({
        allowed: false,
        range: 'invalid',
      })
    },
  )
})
