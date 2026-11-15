import { describe, expect, it } from 'vitest'
import {
  RISKY_HOSTS,
  classifySkillUrl,
  findRiskyHost,
} from '#shared/utils/skills/url-hosts'

describe('classifySkillUrl', () => {
  it.each([
    ['https://discord.com/api/webhooks/1/abc', 'url-risky-host', 'high'],
    ['https://discordapp.com/api/webhooks/1/abc', 'url-risky-host', 'high'],
    ['https://hooks.slack.com/services/T/B/x', 'url-risky-host', 'high'],
    ['https://api.telegram.org/bot123:abc/sendMessage', 'url-risky-host', 'high'],
    ['https://webhook.site/abc', 'url-risky-host', 'high'],
    ['https://eo1.m.pipedream.net/', 'url-risky-host', 'high'],
    ['https://abc.ngrok-free.app/x', 'url-risky-host', 'high'],
    ['https://abc.trycloudflare.com/x', 'url-risky-host', 'high'],
    ['https://x.oast.fun/', 'url-risky-host', 'high'],
    ['https://x.burpcollaborator.net/', 'url-risky-host', 'high'],
    ['https://pastebin.com/raw/abc', 'url-risky-host', 'medium'],
    ['https://transfer.sh/a/b', 'url-risky-host', 'medium'],
    ['https://me.duckdns.org/', 'url-risky-host', 'medium'],
    ['https://bit.ly/x', 'url-risky-host', 'medium'],
    ['https://t.co/x', 'url-risky-host', 'medium'],
  ])('rates the host of %s as %s %s', (url, rule, severity) => {
    expect(classifySkillUrl(url)).toMatchObject({ rule, severity })
  })

  it('needs the webhook path on a host that is also used for other things', () => {
    expect(classifySkillUrl('https://discord.com/channels/1/2')).toBeNull()
    expect(classifySkillUrl('https://api.telegram.org/file/x')).toBeNull()
  })

  it('matches subdomains but not look-alike suffixes', () => {
    expect(classifySkillUrl('https://a.b.hooks.slack.com/x')).toMatchObject({
      severity: 'high',
    })
    expect(classifySkillUrl('https://nothooks.slack.com.example/x')).toBeNull()
    expect(classifySkillUrl('https://bit.ly.example.com/x')).toBeNull()
  })

  it.each([
    ['http://203.0.113.9/a', 'medium'],
    ['https://8.8.8.8/a', 'medium'],
    ['http://127.0.0.1:3000/mcp', 'medium'],
    ['http://[::1]/a', 'medium'],
    ['http://10.0.0.5/a', 'high'],
    ['http://192.168.1.5/a', 'high'],
    ['http://172.20.1.1/a', 'high'],
    ['http://169.254.169.254/latest/meta-data', 'high'],
    ['http://[fd00::1]/a', 'high'],
    ['http://2130706433/a', 'medium'],
  ])('rates the IP literal in %s as %s', (url, severity) => {
    expect(classifySkillUrl(url)).toMatchObject({
      rule: 'url-ip-address',
      severity,
    })
  })

  it('does not call a public 172 address private', () => {
    expect(classifySkillUrl('https://172.32.0.1/a')).toMatchObject({
      severity: 'medium',
    })
  })

  it('flags a punycode host, which is how a non-ASCII host name arrives', () => {
    expect(classifySkillUrl('https://xn--pple-43d.com/')).toMatchObject({
      rule: 'url-international-host',
      severity: 'medium',
    })
    expect(classifySkillUrl('https://аpple.com/')).toMatchObject({
      rule: 'url-international-host',
      severity: 'medium',
    })
  })

  it.each([
    ['https://example.com/install.sh'],
    ['https://example.com/a/b.ps1?x=1'],
    ['https://example.com/tool.py'],
    ['https://example.com/payload.zip'],
    ['https://example.com/a.7z'],
    ['https://example.com/a.exe'],
    ['https://example.com/a.dmg'],
    ['https://example.com/a.pkg'],
  ])('flags %s as a link to a script or archive', (url) => {
    expect(classifySkillUrl(url)).toMatchObject({
      rule: 'url-script-link',
      severity: 'medium',
    })
  })

  it('rates plain http and a non-standard port as low', () => {
    expect(classifySkillUrl('http://example.com/a')).toMatchObject({
      rule: 'url-plain-http',
      severity: 'low',
    })
    expect(classifySkillUrl('https://example.com:8443/a')).toMatchObject({
      rule: 'url-odd-port',
      severity: 'low',
    })
  })

  it('says nothing about an ordinary https link or a broken one', () => {
    expect(classifySkillUrl('https://docs.example.com/guide')).toBeNull()
    expect(classifySkillUrl('https://github.com/a/b/blob/main/README.md'))
      .toBeNull()
    expect(classifySkillUrl('https://:bad')).toBeNull()
    expect(classifySkillUrl('not a url')).toBeNull()
  })

  it('gives the most important reason when several apply', () => {
    expect(classifySkillUrl('http://hooks.slack.com:8080/x.sh')).toMatchObject({
      rule: 'url-risky-host',
    })
  })
})

describe('findRiskyHost', () => {
  it('returns the list entry for a risky host and null otherwise', () => {
    expect(findRiskyHost('https://webhook.site/a')).toMatchObject({
      kind: 'request catcher host',
      severity: 'high',
    })
    expect(findRiskyHost('https://example.com/')).toBeNull()
  })

  it('lists no host twice', () => {
    const hosts = RISKY_HOSTS.flatMap((entry) => {
      return [...entry.hosts]
    })

    expect(new Set(hosts).size).toBe(hosts.length)
  })
})
