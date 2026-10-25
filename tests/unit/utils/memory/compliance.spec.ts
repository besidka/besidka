import { describe, expect, it, vi } from 'vitest'
import { REDACTION_PLACEHOLDER } from '#shared/utils/memory-policy'
import {
  detectNeverStore,
  evaluateMemoryEntry,
  recordBlockedCounts,
  recordSensitiveDetection,
  redactNeverStore,
} from '~~/server/utils/memory/compliance'

function luhnCompleteCard(partialDigits: string): string {
  for (let checkDigit = 0; checkDigit < 10; checkDigit++) {
    const candidate = `${partialDigits}${checkDigit}`
    let sum = 0

    for (let index = 0; index < candidate.length; index++) {
      let digit = Number(candidate[candidate.length - 1 - index])

      if (index % 2 === 1) {
        digit *= 2
        digit = digit > 9 ? digit - 9 : digit
      }

      sum += digit
    }

    if (sum % 10 === 0) {
      return candidate
    }
  }

  throw new Error('unreachable')
}

function buildIban(countryCode: string, bban: string): string {
  const numeric = `${bban}${countryCode}00`
    .split('')
    .map(character => Number.parseInt(character, 36).toString())
    .join('')
  const checkDigits = String(98n - (BigInt(numeric) % 97n)).padStart(2, '0')

  return `${countryCode}${checkDigits}${bban}`
}

function groupByFour(compact: string): string {
  return compact.match(/.{1,4}/gu)!.join(' ')
}

function buildRnokpp(baseDigits: string): string {
  const weights = [-1, 5, 7, 9, 4, 6, 10, 5, 7]
  const sum = weights.reduce((total, weight, index) => {
    return total + weight * Number(baseDigits[index])
  }, 0)
  const checkDigit = (((sum % 11) + 11) % 11) % 10

  return `${baseDigits}${checkDigit}`
}

function buildNip(baseDigits: string): string {
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  const sum = weights.reduce((total, weight, index) => {
    return total + weight * Number(baseDigits[index])
  }, 0)

  return `${baseDigits}${sum % 11}`
}

function kindsOf(text: string): string[] {
  return detectNeverStore(text).map(match => match.kind)
}

const polishIban = 'PL61109010140000071219812874'
const ukrainianIban = buildIban('UA', '3223130000026007233566001')
const germanIban = buildIban('DE', '370400440532013000')
const rnokpp = buildRnokpp('234567890')
const generatedCard = luhnCompleteCard('411111111111999')
const fakeBody = 'FAKE1234fake5678FAKE9012fake3456'

describe('payment-card detector', () => {
  it.each([
    ['4111 1111 1111 1111'],
    ['5555555555554444'],
    ['378282246310005'],
    ['4111-1111-1111-1111'],
    ['3782 822463 10005'],
    [generatedCard],
  ])('detects %s', (card) => {
    expect(kindsOf(`my card is ${card} ok`)).toEqual(['payment-card'])
  })

  it('reports the exact span of the card', () => {
    const text = 'card 4111 1111 1111 1111 expires soon'
    const [match] = detectNeverStore(text)

    expect(text.slice(match!.start, match!.end)).toBe('4111 1111 1111 1111')
  })

  it('detects a card glued to Cyrillic letters', () => {
    expect(kindsOf('карта 4111 1111 1111 1111')).toEqual(['payment-card'])
    expect(kindsOf('карта4111111111111111')).toEqual(['payment-card'])
    expect(kindsOf('4111111111111111картка')).toEqual(['payment-card'])
  })

  it.each([
    ['fullwidth digits', '４１１１ １１１１ １１１１ １１１１'],
    ['fullwidth digits and ideographic spaces', '４１１１　１１１１　１１１１　１１１１'],
    ['non-breaking spaces', '4111\u00A01111\u00A01111\u00A01111'],
    ['thin and em spaces', '4111\u20091111\u20031111\u20281111'],
    ['zero-width characters', '4\u200B111 11\u200D11 1111 \u20601111'],
    ['soft hyphens', '41\u00AD11 1111 1111 1111'],
    ['dots', '4111.1111.1111.1111'],
    ['double spaces', '4111  1111  1111  1111'],
    ['newlines', '4111\n1111\n1111\n1111'],
    ['blank lines', '4111\n\n1111\n\n1111\n\n1111'],
    ['markdown emphasis', '4111**1111**1111**1111'],
    ['mixed separators', '4111 -1111.1111 *1111'],
  ])('detects a card written with %s', (_label, card) => {
    expect(kindsOf(`pay with ${card} today`)).toEqual(['payment-card'])
  })

  it('redacts only the card and keeps the surrounding original text', () => {
    const fullwidthCard = '４１１１ １１１１ １１１１ １１１１'
    const text = `ｆｕｌｌ\u200Bwidth ${fullwidthCard} ｔｅｘｔ`
    const redacted = redactNeverStore(text)

    expect(redacted.text).toBe(
      `ｆｕｌｌ\u200Bwidth ${REDACTION_PLACEHOLDER} ｔｅｘｔ`,
    )
    expect(redacted.blocked).toEqual({ 'payment-card': 1 })
  })

  it('keeps blank lines and markdown structure byte-identical', () => {
    const blob = [
      '**Purpose & Context**',
      '',
      'This memo covers the migration plan.',
      '',
      '**Key Learnings and Principles**',
      '',
      '- Prefer additive schema changes.',
      '- Keep entries short.',
      '',
      '## Open questions',
      '',
      'Who owns the rollout?',
    ].join('\n')
    const redacted = redactNeverStore(blob)

    expect(redacted.text).toBe(blob)
    expect(redacted.blocked).toEqual({})
  })

  it('changes only the secret span inside a multi-section blob', () => {
    const before = [
      '**Purpose & Context**',
      '',
      'Deploys use the staging account.',
      '',
      '**Key Learnings**',
      '',
    ].join('\n')
    const after = '\n\nKeep entries short.'
    const redacted = redactNeverStore(
      `${before}password: hunter22${after}`,
    )

    expect(redacted.text.startsWith(before)).toBe(true)
    expect(redacted.text.endsWith(after)).toBe(true)
    expect(redacted.text).not.toContain('hunter22')
    expect(redacted.blocked).toEqual({ credential: 1 })
  })

  it('maps the span of a normalized card back to original offsets', () => {
    const text = 'x 4\u200B111\u00A01111 1111 1111!'
    const [match] = detectNeverStore(text)

    expect(text.slice(match!.start, match!.end)).toBe(
      '4\u200B111\u00A01111 1111 1111',
    )
  })

  it('detects a card after an unrelated number group', () => {
    expect(kindsOf('2026-10-25 4111111111111111')).toEqual(['payment-card'])
  })

  it.each([
    ['4111 1111 1111 1112', 'fails Luhn'],
    ['4444444444444444', 'repeats one digit'],
    ['1761390000000', 'a 13-digit epoch in milliseconds'],
    ['9783161484100', 'an ISBN-13'],
    ['ISBN 978-3-16-148410-0', 'a hyphenated ISBN-13'],
    ['+380671234567', 'a 12-digit phone number'],
    ['+380 67 123 45 67', 'a spaced phone number'],
    ['1 234 567,89', 'a price'],
    ['2026-10-25', 'a date'],
    ['номер замовлення 1234567890123', 'a Cyrillic order number'],
    ['v1.2.3 build 20261025', 'a version string'],
    ['1.234.567.890.123', 'a dotted number'],
    ['1 234 567 890 123', 'a spaced number'],
    ['$1,234,567.89 total', 'a price with separators'],
    ['12.50 14.75 19.99 21.00 33.10', 'a list of prices'],
    ['4.2.1.0.3 release', 'a dotted version'],
  ])('ignores %s (%s)', (text) => {
    expect(kindsOf(text)).toEqual([])
  })
})

describe('iban detector', () => {
  it.each([
    ['PL61 1090 1014 0000 0712 1981 2874'],
    [polishIban],
    [polishIban.toLowerCase()],
    [ukrainianIban],
    [groupByFour(ukrainianIban)],
    [groupByFour(germanIban)],
    ['61 1090 1014 0000 0712 1981 2874'],
    ['61109010140000071219812874'],
  ])('detects %s', (iban) => {
    expect(kindsOf(`рахунок: ${iban}.`)).toEqual(['iban'])
  })

  it.each([
    ['hyphenated groups', germanIban.match(/.{1,4}/gu)!.join('-')],
    ['double-spaced groups', germanIban.match(/.{1,4}/gu)!.join('  ')],
    ['fullwidth characters', groupByFour(germanIban).replace(
      /[0-9A-Z]/gu,
      character => String.fromCodePoint(character.codePointAt(0)! + 0xFEE0),
    )],
    ['non-breaking spaces', groupByFour(germanIban).replaceAll(' ', '\u00A0')],
    ['zero-width characters', `${germanIban.slice(0, 6)}\u200B${germanIban.slice(6)}`],
  ])('detects an IBAN written with %s', (_label, iban) => {
    expect(kindsOf(`account ${iban} thanks`)).toEqual(['iban'])
  })

  it('stays fast on 100 KB of IBAN-shaped noise and still redacts', () => {
    const validIban = groupByFour(germanIban)

    for (const unit of ['XX00 ', 'ab12 cd34 ']) {
      const noise = unit.repeat(Math.ceil(100_000 / unit.length))
      const startedAt = performance.now()
      const redacted = redactNeverStore(`${noise}${validIban}`)
      const elapsed = performance.now() - startedAt

      expect(elapsed).toBeLessThan(300)
      expect(redacted.text.endsWith(REDACTION_PLACEHOLDER)).toBe(true)
      expect(redacted.blocked.iban).toBeGreaterThanOrEqual(1)
    }
  })

  it('accepts an unknown country within 15 to 34 characters', () => {
    const exotic = buildIban('XK', '1234567890123')

    expect(exotic).toHaveLength(17)
    expect(kindsOf(`account ${exotic}`)).toEqual(['iban'])
  })

  it('reports the span without trailing words', () => {
    const text = `${groupByFour(germanIban)} is my account`
    const [match] = detectNeverStore(text)

    expect(text.slice(match!.start, match!.end)).toBe(groupByFour(germanIban))
  })

  it.each([
    ['PL61 1090 1014 0000 0712 1981 2875', 'bad checksum'],
    ['PL61 1090 1014 0000 0712 1981', 'too short for Poland'],
    ['61 1090 1014 0000 0712 1981 2875', 'bad NRB checksum'],
    ['ID12 ordinary words follow here', 'not an account'],
  ])('ignores %s (%s)', (text) => {
    expect(kindsOf(text)).not.toContain('iban')
  })
})

describe('national-id detector', () => {
  it('detects a valid PESEL', () => {
    expect(kindsOf('PESEL 44051401359')).toEqual(['national-id'])
    expect(kindsOf('мій pesel:44051401359')).toEqual(['national-id'])
  })

  it('detects a PESEL for the 2000s month band', () => {
    const base = '02271409'
    const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
    const partial = `${base}${'82'}`.slice(0, 10)
    const sum = weights.reduce((total, weight, index) => {
      return total + weight * Number(partial[index])
    }, 0)
    const pesel = `${partial}${(10 - (sum % 10)) % 10}`

    expect(kindsOf(`pesel ${pesel}`)).toEqual(['national-id'])
  })

  it('rejects a PESEL with a bad checksum or impossible date', () => {
    expect(kindsOf('44051401358')).toEqual([])
    expect(kindsOf('44053201351')).toEqual([])
  })

  it('detects a US SSN', () => {
    expect(kindsOf('SSN 123-45-6789')).toEqual(['national-id'])
  })

  it.each([
    ['000-45-6789'],
    ['666-45-6789'],
    ['900-45-6789'],
    ['123-00-6789'],
    ['123-45-0000'],
    ['123456789'],
    ['2026-10-25'],
  ])('ignores %s', (text) => {
    expect(kindsOf(text)).toEqual([])
  })
})

describe('tax-id detector', () => {
  it.each([
    ['NIP 1234563218'],
    ['NIP: 123-456-32-18'],
    [`numer identyfikacji podatkowej: ${buildNip('987654321')}`],
    [`ІПН ${rnokpp}`],
    [`РНОКПП: ${rnokpp}`],
    [`мій ідентифікаційний код ${rnokpp}`],
    [`податковий номер - ${rnokpp}`],
    [`TIN ${rnokpp}`],
    [`ИНН ${rnokpp}`],
    [`my tax id is ${rnokpp}`],
  ])('detects %s', (text) => {
    expect(kindsOf(text)).toEqual(['tax-id'])
  })

  it('redacts only the number and keeps the keyword', () => {
    expect(redactNeverStore(`NIP 1234563218`).text).toBe(
      `NIP ${REDACTION_PLACEHOLDER}`,
    )
  })

  it('requires a keyword before the number', () => {
    expect(kindsOf(rnokpp)).toEqual([])
    expect(kindsOf('NIP 1234563218')).toEqual(['tax-id'])
    expect(kindsOf('1234563218')).toEqual([])
  })

  it('ignores a keyword that is too far from the number', () => {
    const filler = 'x'.repeat(60)

    expect(kindsOf(`NIP ${filler} 1234563218`)).toEqual([])
  })

  it('ignores a phone number even with a tax keyword', () => {
    expect(kindsOf('ІПН 0671234567')).toEqual([])
    expect(kindsOf('NIP 0671234567')).toEqual([])
  })

  it('ignores a 10-digit phone number without a keyword', () => {
    expect(kindsOf('тел. 0671234567')).toEqual([])
    expect(kindsOf('call 0671234567')).toEqual([])
  })

  it('does not treat keywords inside other words as keywords', () => {
    expect(kindsOf(`MINIPUT ${rnokpp}`)).toEqual([])
  })
})

describe('passport detector', () => {
  it.each([
    ['Passport: AB1234567'],
    ['passport no. AB 1234567'],
    ['paszport nr XY1234567'],
    ['паспорт серії АА номер 123456'],
    ['паспорт № ВК 123456'],
    ['my passport number is 123456789'],
    ['Pasport EF1234567'],
    ['passport no. 123456789'],
    ['паспорт: АА123456'],
    ['паспорт серії АА номер 123456'],
    ['паспорт серія АА № 123456'],
    ['Passport # 123456789'],
  ])('detects %s', (text) => {
    expect(kindsOf(text)).toEqual(['passport'])
  })

  it('redacts only the identifier', () => {
    expect(redactNeverStore('Passport: AB1234567').text).toBe(
      `Passport: ${REDACTION_PLACEHOLDER}`,
    )
  })

  it.each([
    ['my passport is valid until 2030'],
    ['passport office is open on weekdays'],
    ['AB1234567 is a part number'],
    ['passport 1234567890123456'],
    ['passport'],
    ['passport photos 123456 in folder'],
    ['passport scans 123456789 attached'],
    ['паспорт документи 123456 у папці'],
  ])('ignores %s', (text) => {
    expect(kindsOf(text)).toEqual([])
  })
})

describe('api-key detector', () => {
  it.each([
    [`sk-ant-api03-${fakeBody}`],
    [`sk-proj-${fakeBody}`],
    [`sk-${fakeBody}`],
    [`AIza${'Fake1234'.repeat(5).slice(0, 35)}`],
    [`AQ.${fakeBody}`],
    [`ghp_${fakeBody}`],
    [`github_pat_${fakeBody}${fakeBody.slice(0, 12)}`],
    ['xoxb-123456789012-FAKEFAKEFAKE'],
    ['AKIAFAKEFAKEFAKE1234'],
    ['ASIAFAKEFAKEFAKE1234'],
    ['sk_live_FAKEFAKEFAKEFAKE1234'],
    ['pk_test_FAKEFAKEFAKEFAKE1234'],
    [`xai-${fakeBody}`],
    [`gsk_${fakeBody}`],
    [`hf_${fakeBody}`],
    [`npm_${fakeBody}FAKE`],
    ['glpat-FAKEFAKEFAKEFAKE1234'],
    ['SG.FAKEFAKEFAKE1234.FAKEFAKEFAKE5678'],
    [`Bearer ${fakeBody}`],
  ])('detects %s', (key) => {
    expect(kindsOf(`use ${key} for it`)).toEqual(['api-key'])
  })

  it('redacts the whole key', () => {
    expect(redactNeverStore(`key sk-${fakeBody} end`).text).toBe(
      `key ${REDACTION_PLACEHOLDER} end`,
    )
  })

  it.each([
    ['sk-'],
    ['sk- is a prefix'],
    ['task-force'],
    ['ask-me-anything-about-everything-you-want'],
    ['sk-short'],
    ['Bearer of good news'],
    ['hf_short'],
    ['vck_short'],
    ['BSA-short'],
  ])('ignores %s', (text) => {
    expect(kindsOf(text)).toEqual([])
  })

  it.each([
    [`vck_${fakeBody}`],
    [`BSA${fakeBody}`],
    [`BSA_${fakeBody}`],
  ])('detects the gateway and search key %s', (key) => {
    expect(kindsOf(`use ${key} for it`)).toEqual(['api-key'])
  })

  describe('keyword-gated shapes', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    const hexToken = '9fceb02d0ae598e95dc970b74767f19372d61af8'
    const mixedToken = 'Kj3hG8sLp2QwXz9RtY6uVb4NmA7cD5eF'

    it.each([
      [`my exa ${uuid}`],
      [`the Cloudflare account ${uuid}`],
      [`brave search ${uuid}`],
      [`vercel gateway is ${uuid}`],
      [`openrouter ${uuid}`],
      [`the api key for prod ${uuid}`],
      [`API_KEY ${uuid}`],
      [`secret token ${uuid}`],
      [`ключ для сервісу ${uuid}`],
      [`наш секрет ${uuid}`],
      [`exa ${mixedToken}`],
      [`cloudflare token ${hexToken}`],
      [`ключ ${mixedToken}`],
    ])('detects %s', (text) => {
      expect(kindsOf(text)).toEqual(['api-key'])
    })

    it('redacts only the gated value and keeps the keyword', () => {
      expect(redactNeverStore(`brave search ${uuid} ok`).text).toBe(
        `brave search ${REDACTION_PLACEHOLDER} ok`,
      )
    })

    it.each([
      [`request id ${uuid}`],
      [uuid],
      [`commit ${hexToken}`],
      [hexToken],
      [`example ${uuid}`],
      [`exam ${uuid}`],
      [`cloudflare ${'x'.repeat(60)} ${uuid}`],
      [`token ${'a'.repeat(40)}`],
      [`token ${'7'.repeat(40)}`],
      [`token ${mixedToken}${mixedToken}${mixedToken}`],
      ['token short1234'],
    ])('ignores %s', (text) => {
      expect(kindsOf(text)).toEqual([])
    })
  })
})

describe('jwt detector', () => {
  const jwt = [
    'eyJhbGciOiJIUzI1NiJ9',
    'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
    'dGVzdHNpZ25hdHVyZQ',
  ].join('.')

  it('detects a three-part token', () => {
    expect(kindsOf(`token ${jwt}`)).toEqual(['jwt'])
  })

  it('merges with a Bearer prefix into one match', () => {
    const matches = detectNeverStore(`Authorization: Bearer ${jwt}`)

    expect(matches).toHaveLength(1)
  })

  it('ignores a two-part dotted string', () => {
    expect(kindsOf('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0')).toEqual(
      [],
    )
  })
})

describe('credential detector', () => {
  it.each([
    ['password: hunter22'],
    ['password=hunter22'],
    ['"password": "hunter22"'],
    ['пароль: qwerty123'],
    ['hasło: tajne1234'],
    ['api_key=abc123def456'],
    ['accessToken: abcdef123456'],
    ['My password is hunter22'],
    ['Мій пароль є qwerty123'],
    ['hasło jest tajne#123'],
    ['пароль это 12345678'],
    ['passphrase is correct-horse-battery'],
    ['password = "my secret pass"'],
    ['password: \'two words here\''],
    ['"password": "my secret pass"'],
    ['пароль це qwerty123'],
    ['password was hunter22'],
    ['password - hunter22'],
    ['пароль — qwerty123'],
    ['парольна фраза: коротка фраза'],
    ['secret: Abc123Def'],
    ['token = a1b2c3d4e5'],
    ['токен: abc123xyz789'],
    ['ключ: abc-123-xyz'],
    ['api key: sk_test_abcdefghij1234'],
    ['token: abc123def456'],
    ['API_KEY=Zx9!kLm2pQ'],
    ['secret = "s3cr3t-value"'],
  ])('detects %s', (text) => {
    expect(kindsOf(text)).toEqual(['credential'])
  })

  it('keeps the label readable and redacts only the value', () => {
    expect(redactNeverStore('password: hunter22').text).toBe(
      `password: ${REDACTION_PLACEHOLDER}`,
    )
    expect(redactNeverStore('"token": "abcdef123456"').text).toBe(
      `"token": "${REDACTION_PLACEHOLDER}"`,
    )
    expect(redactNeverStore('My password is hunter22.').text).toBe(
      `My password is ${REDACTION_PLACEHOLDER}.`,
    )
  })

  it('redacts a quoted value with spaces in full', () => {
    expect(redactNeverStore('password = "my secret pass" done').text).toBe(
      `password = "${REDACTION_PLACEHOLDER}" done`,
    )
    expect(redactNeverStore('пароль: \'мій секретний пароль\'.').text).toBe(
      `пароль: '${REDACTION_PLACEHOLDER}'.`,
    )
  })

  it('redacts a strong label value of any shape', () => {
    expect(redactNeverStore('password: correcthorse').text).toBe(
      `password: ${REDACTION_PLACEHOLDER}`,
    )
    expect(redactNeverStore('пароль: правильнийкінь').text).toBe(
      `пароль: ${REDACTION_PLACEHOLDER}`,
    )
  })

  it('redacts URL userinfo and keeps scheme and host', () => {
    const redacted = redactNeverStore(
      'postgres://admin:s3cretpass@db.internal:5432/app',
    )

    expect(redacted.text).toBe(
      `postgres://${REDACTION_PLACEHOLDER}@db.internal:5432/app`,
    )
    expect(redacted.blocked).toEqual({ credential: 1 })
  })

  it('ignores URLs without a password', () => {
    expect(kindsOf('https://user@example.com/path')).toEqual([])
    expect(kindsOf('https://example.com:8080/path')).toEqual([])
  })

  it.each([
    ['I use a password manager'],
    ['забув пароль'],
    ['password is required'],
    ['the password is stored safely'],
    ['password: short'],
    ['token is expired'],
    ['please reset your password'],
    ['пароль є важливим'],
    ['Uses API key: stored in KV'],
    ['ключ: значення для команди'],
    ['passport photos 123456 in folder'],
    ['token: expired'],
    ['secret: confidential'],
    ['api key: configured'],
    ['key: primary'],
    ['primary key: user_id'],
    ['foreign key: org_id'],
    ['cache key: user:123'],
    ['secret_name: my_secret_value'],
    ['monkey: abc123def456'],
    ['secret = "stored in vault"'],
    ['ключ = "значення для команди"'],
    ['password - required'],
    ['пароль - обовʼязковий'],
    ['password was reset'],
    ['пароль це секрет'],
  ])('ignores %s', (text) => {
    expect(kindsOf(text)).toEqual([])
  })
})

describe('private-key detector', () => {
  const pem = [
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEAfakefakefake',
    '-----END RSA PRIVATE KEY-----',
  ].join('\n')

  it('redacts a terminated block through its END marker', () => {
    const redacted = redactNeverStore(`before\n${pem}\nafter`)

    expect(redacted.text).toBe(`before\n${REDACTION_PLACEHOLDER}\nafter`)
    expect(redacted.blocked).toEqual({ 'private-key': 1 })
  })

  it('redacts an unterminated block to the end of the text', () => {
    const redacted = redactNeverStore(
      'key:\n-----BEGIN PRIVATE KEY-----\nMIIEvQfake\nmorefake',
    )

    expect(redacted.text).toBe(`key:\n${REDACTION_PLACEHOLDER}`)
  })

  it('ignores a public key block', () => {
    expect(
      kindsOf('-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----'),
    ).toEqual([])
  })
})

describe('overlap merging', () => {
  it('merges overlapping detections into one sorted span', () => {
    const text = `password=sk-${fakeBody} and card 4111 1111 1111 1111`
    const matches = detectNeverStore(text)

    expect(matches).toHaveLength(2)
    expect(matches[0]!.start).toBeLessThan(matches[1]!.start)
    expect(matches[0]!.end).toBeLessThanOrEqual(matches[1]!.start)
  })

  it('returns non-overlapping spans for a dense text', () => {
    const text = [
      `PESEL 44051401359 IBAN ${groupByFour(polishIban)}`,
      `card 5555555555554444 key ghp_${fakeBody}`,
    ].join(' ')
    const matches = detectNeverStore(text)

    for (let index = 1; index < matches.length; index++) {
      expect(matches[index]!.start).toBeGreaterThanOrEqual(
        matches[index - 1]!.end,
      )
    }

    expect(matches.map(match => match.kind).toSorted()).toEqual([
      'api-key',
      'iban',
      'national-id',
      'payment-card',
    ])
  })

  it('does not double count a token that is also a labelled value', () => {
    const redacted = redactNeverStore(`token: ghp_${fakeBody}`)

    expect(redacted.blockedTotal).toBe(1)
    expect(redacted.text).toBe(`token: ${REDACTION_PLACEHOLDER}`)
  })
})

describe('redactNeverStore', () => {
  it('returns the original text untouched when nothing matches', () => {
    const text = 'Ordinary note about 2026-10-25 and a task-force.'

    expect(redactNeverStore(text)).toEqual({
      text,
      blocked: {},
      blockedTotal: 0,
    })
  })

  it('replaces every span and counts per kind', () => {
    const redacted = redactNeverStore(
      'cards 4111111111111111 and 5555555555554444, PESEL 44051401359',
    )

    expect(redacted.text).toBe(
      `cards ${REDACTION_PLACEHOLDER} and ${REDACTION_PLACEHOLDER}, `
      + `PESEL ${REDACTION_PLACEHOLDER}`,
    )
    expect(redacted.blocked).toEqual({
      'payment-card': 2,
      'national-id': 1,
    })
    expect(redacted.blockedTotal).toBe(3)
  })

  it('never leaves the secret in the output', () => {
    const secret = 'hunter22secret'
    const redacted = redactNeverStore(`password = ${secret}`)

    expect(redacted.text).not.toContain(secret)
  })
})

describe('recordBlockedCounts', () => {
  it('logs only counts under attributes.memoryCompliance', () => {
    const logger = { set: vi.fn() }

    recordBlockedCounts({ 'payment-card': 2, 'jwt': 1 }, logger, 'tool')

    expect(logger.set).toHaveBeenCalledTimes(1)
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        memoryCompliance: {
          origin: 'tool',
          blocked: { 'payment-card': 2, 'jwt': 1 },
          blockedTotal: 3,
        },
      },
    })
  })

  it('stays silent when nothing was blocked', () => {
    const logger = { set: vi.fn() }

    recordBlockedCounts({}, logger, 'extraction')
    recordBlockedCounts({ jwt: 0 }, logger, 'extraction')

    expect(logger.set).not.toHaveBeenCalled()
  })

  it('never puts matched content in the logged payload', () => {
    const logger = { set: vi.fn() }
    const secretCard = '4111 1111 1111 1111'
    const secretKey = `sk-${fakeBody}`
    const text = `card ${secretCard} key ${secretKey} password: hunter22`
    const redacted = redactNeverStore(text)

    recordBlockedCounts(redacted.blocked, logger, 'ui')

    const serialized = JSON.stringify(logger.set.mock.calls)

    expect(serialized).not.toContain('4111')
    expect(serialized).not.toContain(fakeBody)
    expect(serialized).not.toContain('hunter22')
    expect(serialized).toContain('"origin":"ui"')
    expect(serialized).toContain('"blockedTotal":3')
  })
})

describe('recordSensitiveDetection', () => {
  it('records category ids and the origin only', () => {
    const logger = { set: vi.fn() }

    recordSensitiveDetection(['health', 'drugs'], logger, 'memory-api')

    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        memoryCompliance: {
          sensitive: { origin: 'memory-api', categories: ['health', 'drugs'] },
        },
      },
    })
  })

  it('records nothing when the classifier found nothing', () => {
    const logger = { set: vi.fn() }

    recordSensitiveDetection([], logger, 'memory-api')

    expect(logger.set).not.toHaveBeenCalled()
  })

  it('merges with the categories already logged in the request', () => {
    const context: Record<string, unknown> = {}
    const logger = {
      set: vi.fn((fields: Record<string, unknown>) => {
        Object.assign(context, fields)
      }),
      getContext: () => context,
    }

    recordSensitiveDetection(['health', 'drugs'], logger, 'memory-api')
    recordSensitiveDetection(['drugs', 'genetic'], logger, 'memory-tool')
    recordSensitiveDetection(['health'], logger, 'memory-tool')

    expect(context).toEqual({
      attributes: {
        memoryCompliance: {
          sensitive: {
            origin: 'memory-tool',
            categories: ['health', 'drugs', 'genetic'],
          },
        },
      },
    })
  })
})

describe('evaluateMemoryEntry', () => {
  const cleanEntry = {
    title: 'Prefers TypeScript',
    description: 'Likes strict typing',
    body: 'Uses TypeScript on every project.',
    sensitivity: 'none' as const,
  }

  it('allows a clean entry', () => {
    expect(evaluateMemoryEntry(cleanEntry)).toEqual({ allowed: true })
  })

  it('blocks a detector hit in the body', () => {
    expect(
      evaluateMemoryEntry({
        ...cleanEntry,
        body: 'Card 4111 1111 1111 1111',
      }),
    ).toEqual({
      allowed: false,
      reason: 'never-store',
      kinds: ['payment-card'],
    })
  })

  it('blocks a detector hit in the title or description', () => {
    expect(
      evaluateMemoryEntry({ ...cleanEntry, title: 'PESEL 44051401359' }),
    ).toMatchObject({ allowed: false, reason: 'never-store' })
    expect(
      evaluateMemoryEntry({
        ...cleanEntry,
        description: `key sk-${fakeBody}`,
      }),
    ).toMatchObject({ allowed: false, reason: 'never-store' })
  })

  it('blocks a card split between the title and the body', () => {
    expect(
      evaluateMemoryEntry({
        ...cleanEntry,
        title: 'Card 4111 1111',
        description: '',
        body: '1111 1111 is the number',
      }),
    ).toEqual({
      allowed: false,
      reason: 'never-store',
      kinds: ['payment-card'],
    })
  })

  it('blocks a card split between the title and the description', () => {
    expect(
      evaluateMemoryEntry({
        ...cleanEntry,
        title: 'Card 4111 1111 1111',
        description: '1111',
      }),
    ).toMatchObject({ allowed: false, reason: 'never-store' })
  })

  it('lists every distinct blocked kind once', () => {
    const verdict = evaluateMemoryEntry({
      ...cleanEntry,
      title: 'Card 4111 1111 1111 1111',
      body: 'Other 5555555555554444 and PESEL 44051401359',
    })

    expect(verdict).toEqual({
      allowed: false,
      reason: 'never-store',
      kinds: ['payment-card', 'national-id'],
    })
  })

  it('blocks when the extractor labelled a never-store kind', () => {
    expect(
      evaluateMemoryEntry({
        ...cleanEntry,
        extractorNeverStoreKind: 'home-address',
      }),
    ).toEqual({
      allowed: false,
      reason: 'never-store',
      kinds: ['home-address'],
    })
  })

  it('ignores a null extractor label', () => {
    expect(
      evaluateMemoryEntry({ ...cleanEntry, extractorNeverStoreKind: null }),
    ).toEqual({ allowed: true })
  })

  it('refuses a declared special entry with no detected category', () => {
    expect(
      evaluateMemoryEntry({ ...cleanEntry, sensitivity: 'special' }),
    ).toEqual({
      allowed: false,
      reason: 'sensitive-topic',
      detectedCategories: [],
    })
  })

  describe('server-side classification', () => {
    const flaggedEntry = {
      ...cleanEntry,
      title: 'Health',
      description: 'Diet constraints',
      body: 'I have type 2 diabetes.',
    }

    it('refuses flagged text declared none with the detected category', () => {
      expect(evaluateMemoryEntry(flaggedEntry)).toEqual({
        allowed: false,
        reason: 'sensitive-topic',
        detectedCategories: ['health'],
      })
    })

    it('refuses flagged text declared special too', () => {
      expect(
        evaluateMemoryEntry({ ...flaggedEntry, sensitivity: 'special' }),
      ).toEqual({
        allowed: false,
        reason: 'sensitive-topic',
        detectedCategories: ['health'],
      })
    })

    it('classifies the title and the description too', () => {
      expect(
        evaluateMemoryEntry({
          ...cleanEntry,
          title: 'Type 2 diabetes',
        }),
      ).toMatchObject({ allowed: false, reason: 'sensitive-topic' })
      expect(
        evaluateMemoryEntry({
          ...cleanEntry,
          description: 'Has type 2 diabetes',
        }),
      ).toMatchObject({ allowed: false, reason: 'sensitive-topic' })
    })

    it('leaves clean text untouched', () => {
      expect(
        evaluateMemoryEntry({
          ...cleanEntry,
          title: 'Church Street address',
          description: 'Diet constraints',
          body: 'Delivery goes to the office on Church Street.',
        }),
      ).toEqual({ allowed: true })
      expect(
        evaluateMemoryEntry({
          ...cleanEntry,
          title: 'Anna',
          description: 'Sister',
          body: 'Anna: sister, lives in Lviv.',
        }),
      ).toEqual({ allowed: true })
    })

    it('refuses the same text about another person under the same rule',
      () => {
        expect(
          evaluateMemoryEntry({
            ...flaggedEntry,
            title: 'Anna',
            description: 'Sister',
            body: 'Anna has type 2 diabetes.',
          }),
        ).toEqual({
          allowed: false,
          reason: 'sensitive-topic',
          detectedCategories: ['health'],
        })
      })

    it('lets never-store beat the classifier', () => {
      expect(
        evaluateMemoryEntry({
          ...flaggedEntry,
          body: 'I have type 2 diabetes, card 4111 1111 1111 1111',
        }),
      ).toMatchObject({ allowed: false, reason: 'never-store' })
    })
  })

  it('lets never-store beat a declared special entry', () => {
    expect(
      evaluateMemoryEntry({
        ...cleanEntry,
        body: 'Diagnosis noted, card 4111 1111 1111 1111',
        sensitivity: 'special',
      }),
    ).toMatchObject({ allowed: false, reason: 'never-store' })
    expect(
      evaluateMemoryEntry({
        ...cleanEntry,
        sensitivity: 'special',
        extractorNeverStoreKind: 'criminal-history',
      }),
    ).toMatchObject({ allowed: false, reason: 'never-store' })
  })
})
