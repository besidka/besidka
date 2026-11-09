import { describe, expect, it } from 'vitest'
import {
  decodeHeaderValue,
  isDmarcPass,
  isUrgentMail,
  resolveMailbox,
} from '~~/workers/mail-alerts/src/classify'

const CLOUDFLARE_DMARC_PASS
  = 'mx.cloudflare.net; dkim=pass header.d=abw.gov.pl; '
    + 'dmarc=pass header.from=abw.gov.pl; spf=pass smtp.mailfrom=abw.gov.pl'

function urgent(
  subject: string,
  fromHeader: string | null = 'Someone <someone@example.com>',
  authenticationResults: string | null = null,
) {
  return isUrgentMail({ subject, fromHeader, authenticationResults })
}

describe('decodeHeaderValue', () => {
  it('decodes base64 and quoted-printable encoded words', () => {
    expect(decodeHeaderValue('=?UTF-8?B?bmFrYXogdXN1bmnEmWNpYQ==?='))
      .toBe('nakaz usunięcia')
    expect(decodeHeaderValue('=?utf-8?Q?nakaz_usuni=C4=99cia?='))
      .toBe('nakaz usunięcia')
  })

  it('joins adjacent encoded words and unfolds folded headers', () => {
    expect(decodeHeaderValue('=?UTF-8?Q?Nakaz?=\r\n =?UTF-8?Q?_usuni=C4=99cia?='))
      .toBe('Nakaz usunięcia')
    expect(decodeHeaderValue('Plain\r\n\tsubject')).toBe('Plain subject')
  })

  it('decodes a Latin-2 word and keeps a broken word as it was', () => {
    expect(decodeHeaderValue('=?ISO-8859-2?Q?Policja_=B3?=')).toBe('Policja ł')
    expect(decodeHeaderValue('=?UTF-8?B?***?=')).toBe('=?UTF-8?B?***?=')
  })
})

describe('isUrgentMail', () => {
  it.each([
    'Removal order under Regulation (EU) 2021/784',
    'NAKAZ USUNIĘCIA treści terrorystycznych',
    'nakaz usuniecia',
    'TCO order 12/2026',
    'Pismo ABW',
    'Komenda Policji - wezwanie',
    'Prokuratura Rejonowa',
    'Data breach at besidka.com',
    'Security vulnerability report',
    'CVE-2026-1234 in the share route',
    'Zgłoszenie naruszenia ochrony danych',
    'Wyciek danych',
  ])('flags "%s" as urgent', (subject) => {
    expect(urgent(subject)).toBe(true)
  })

  it.each([
    'Question about my account',
    'Privacy policy question',
    'Tcohen joined the thread',
    'Abwesenheitsnotiz',
    '',
  ])('does not flag "%s"', (subject) => {
    expect(urgent(subject)).toBe(false)
  })

  it('flags an authority name in the From display name', () => {
    expect(urgent('Pismo', 'Komenda Główna Policji <kgp@example.com>'))
      .toBe(true)
    expect(urgent('Pismo', '=?UTF-8?Q?Prokuratura_Okr=C4=99gowa?= <p@x.pl>'))
      .toBe(true)
  })

  it('trusts an authority domain only with a Cloudflare DMARC pass', () => {
    const from = 'Sekretariat <sekretariat@abw.gov.pl>'

    expect(urgent('Pismo nr 15', from, CLOUDFLARE_DMARC_PASS)).toBe(true)
    expect(urgent('Pismo nr 15', from, null)).toBe(false)
    expect(urgent(
      'Pismo nr 15',
      from,
      'mx.cloudflare.net; dmarc=fail header.from=abw.gov.pl',
    )).toBe(false)
    expect(urgent(
      'Request',
      'Office <office@ec.europa.eu>',
      'mx.cloudflare.net; dmarc=pass header.from=ec.europa.eu',
    )).toBe(true)
  })

  it('ignores a sender-supplied Authentication-Results header', () => {
    const spoofed = 'attacker.example; dmarc=pass, '
      + 'mx.cloudflare.net; dmarc=fail header.from=abw.gov.pl'

    expect(urgent('Pismo', 'x <x@abw.gov.pl>', spoofed)).toBe(false)
  })
})

describe('isDmarcPass', () => {
  it('reads only the first, Cloudflare-prepended result', () => {
    expect(isDmarcPass(CLOUDFLARE_DMARC_PASS)).toBe(true)
    expect(isDmarcPass(
      'mx.cloudflare.net; dmarc=fail, other.example; dmarc=pass',
    )).toBe(false)
    expect(isDmarcPass(null)).toBe(false)
  })
})

describe('resolveMailbox', () => {
  it('maps known local parts, plus addressing and case', () => {
    expect(resolveMailbox('privacy@besidka.com')).toBe('privacy')
    expect(resolveMailbox('Abuse@besidka.com')).toBe('abuse')
    expect(resolveMailbox('security+report@besidka.com')).toBe('security')
    expect(resolveMailbox('contact@besidka.com')).toBe('contact')
    expect(resolveMailbox('mail-alerts-test@besidka.com'))
      .toBe('mail-alerts-test')
  })

  it('returns null for any other address', () => {
    expect(resolveMailbox('hello@besidka.com')).toBeNull()
    expect(resolveMailbox('')).toBeNull()
  })
})
