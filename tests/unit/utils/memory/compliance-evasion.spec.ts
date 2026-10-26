import { describe, expect, it } from 'vitest'
import type { NeverStoreKind, MemorySensitiveCategory } from '#shared/types/memory.d'
import {
  detectNeverStore,
  evaluateMemoryEntry,
} from '~~/server/utils/memory/compliance'
import { classifySensitiveCategories } from '~~/server/utils/memory/sensitivity'
import {
  foldMixedScriptLookalikes,
  foldPolishDiacritics,
  stripLatinDiacritics,
  toAsciiDigit,
} from '~~/server/utils/memory/text-folding'
import { detectTopicalNeverStoreKinds } from '~~/server/utils/memory/topical-never-store'

const SOFT_HYPHEN = '­'
const ZERO_WIDTH_SPACE = '​'
const RIGHT_TO_LEFT_OVERRIDE = '‮'
const POP_DIRECTIONAL_FORMATTING = '‬'
const COMBINING_LOW_LINE = '̲'

function detectedKinds(text: string): NeverStoreKind[] {
  return [...new Set(detectNeverStore(text).map(match => match.kind))]
}

function evaluate(body: string) {
  return evaluateMemoryEntry({
    title: 'Note',
    description: 'A saved note',
    body,
    sensitivity: 'none',
  })
}

describe('text folding', () => {
  it.each([
    ['٤', '4'],
    ['٠', '0'],
    ['۹', '9'],
    ['४', '4'],
    ['৭', '7'],
    ['๓', '3'],
  ])('maps the non-ASCII digit %s to %s', (digit, ascii) => {
    expect(toAsciiDigit(digit)).toBe(ascii)
  })

  it.each(['4', 'a', 'ł', '', '٤٤'])('leaves %j alone', (text) => {
    expect(toAsciiDigit(text)).toBeNull()
  })

  it('folds every Polish diacritic in both cases and nothing else', () => {
    expect(foldPolishDiacritics('ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ їй ё'))
      .toBe('acelnoszz ACELNOSZZ їй ё')
  })

  it('maps look-alikes to the main script of a mixed-script word', () => {
    expect(foldMixedScriptLookalikes('у мене дiабет і cat hіv'))
      .toBe('у мене діабет і cat hiv')
  })

  it('strips Latin accents but keeps Polish and Cyrillic letters', () => {
    expect(stripLatinDiacritics('diabétes naïve ciąża йога ї'))
      .toBe('diabetes naive ciąża йога ї')
  })
})

describe('never-store format evasions (audit finding 10)', () => {
  it.each<[string, string, NeverStoreKind]>([
    ['Arabic-Indic card digits', '٤١١١١١١١١١١١١١١١', 'payment-card'],
    ['Devanagari card digits', '४१११ ११११ ११११ ११११', 'payment-card'],
    ['a slash-separated card', '4111/1111/1111/1111', 'payment-card'],
    ['an underscore-separated card', '4111_1111_1111_1111', 'payment-card'],
    ['a slash-separated Amex card', '3782/822463/10005', 'payment-card'],
    ['an underscore-separated 19-digit card', '4111_1111_1111_1111_003', 'payment-card'],
    ['a dotted IBAN', 'PL61.1090.1014.0000.0712.1981.2874', 'iban'],
    ['a slash-separated IBAN', 'PL61/1090/1014/0000/0712/1981/2874', 'iban'],
    ['a dotted Polish NRB', '61.1090.1014.0000.0712.1981.2874', 'iban'],
    ['a spaced PESEL', 'PESEL 440514 01359', 'national-id'],
    ['a hyphen-grouped PESEL', 'PESEL 44-05-14-01359', 'national-id'],
    ['a NIP with the keyword after it', '1234563218 to mój NIP', 'tax-id'],
    ['a NIP in 3-2-2-3 groups', 'NIP 123-45-63-218', 'tax-id'],
    ['a space-grouped NIP', 'NIP 123 456 32 18', 'tax-id'],
    [
      'an AWS secret with slashes',
      'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      'api-key',
    ],
    ['a Polish copula password', 'moje hasło to Kotek2024!', 'credential'],
    ['an unaccented Polish password', 'moje haslo to Kotek2024!', 'credential'],
    [
      'a Polish password with words before the copula',
      'hasło do banku to Kotek2024!',
      'credential',
    ],
    [
      'an English password with words before the verb',
      'password for my bank is Kotek2024!',
      'credential',
    ],
    [
      'an English password after a "to" phrase',
      'the password to my email account is Kotek2024!',
      'credential',
    ],
    [
      'a card with zero-width spaces',
      `4111${ZERO_WIDTH_SPACE}1111${ZERO_WIDTH_SPACE}1111${ZERO_WIDTH_SPACE}1111`,
      'payment-card',
    ],
  ])('detects %s', (_label, text, kind) => {
    expect(detectedKinds(text)).toContain(kind)
    expect(evaluate(text)).toMatchObject({
      allowed: false,
      reason: 'never-store',
    })
  })

  it('maps a match in a folded view back to the original span', () => {
    const text = 'Card: ٤١١١١١١١١١١١١١١١ thanks'
    const [match] = detectNeverStore(text)

    expect(text.slice(match!.start, match!.end)).toBe('٤١١١١١١١١١١١١١١١')
  })

  it.each([
    ['a list of years', 'Shipped in 2019, 2020, 2021 and 2023'],
    ['dates with slashes', 'Moved on 12/05/2024 and again on 01/09/2025'],
    ['version numbers', 'Upgraded from 1.2.3 to 4.5.6, then 10.0.1'],
    ['a version path', 'Runs node/22/bin and python_3_12'],
    ['PESEL format docs', 'Reads the PESEL format docs: 11 digits, YYMMDD'],
    ['a NIP explainer', 'NIP is a 10-digit Polish tax number'],
    ['a weak password remark', 'My password is strong and changed often'],
    ['a Polish security remark', 'Hasło to podstawa bezpieczeństwa'],
    ['an AWS how-to', 'Wrote the AWS secret rotation guide for the team'],
    ['a password-to sentence', 'The password to the wifi is on the fridge'],
    ['a comma-joined digit list', 'Listing numbers 5, 3, 2, 8, 4, 9, 1, 6, 7, 2, 3, 4, 5, 6'],
    ['a JSON digit array', '[4,3,2,8,4,9,1,6,7,2,3,4,5,6]'],
    ['comma thousands', 'Order id 1,234,567,890,123,456'],
    ['a slash date with a room number', 'Meeting 2025/10/26 14:30 room 4111'],
    ['comma-joined 4-digit numbers', '4111,1111,1111,1111,4111,1111'],
    ['a five-group slash run', '4111/1111/1111/1111/1111'],
    ['a slash run glued to a longer path', 'ids 12/4111/1111/1111/1111'],
  ])('does not flag %s', (_label, text) => {
    expect(detectNeverStore(text)).toEqual([])
  })
})

describe('never-store false positives on generated number lists (delta '
  + 'verification NEW-3)', () => {
  const TRIALS = 2000

  function createRandom(seed: number) {
    let state = seed

    return (limit: number) => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648

      return state % limit
    }
  }

  type NumberSource = (limit: number) => number

  function countFlagged(generate: (random: NumberSource) => string) {
    const random = createRandom(20261026)
    let flagged = 0

    for (let trial = 0; trial < TRIALS; trial++) {
      if (detectNeverStore(generate(random)).length > 0) {
        flagged += 1
      }
    }

    return flagged
  }

  function padded(value: number) {
    return String(value).padStart(2, '0')
  }

  it.each<[string, (random: NumberSource) => string]>([
    ['six comma-joined numbers up to 9999', (random) => {
      return Array.from({ length: 6 }, () => random(10_000)).join(',')
    }],
    ['six comma-joined 4-digit numbers', (random) => {
      return Array.from({ length: 6 }, () => 1000 + random(9000)).join(',')
    }],
    ['six comma-and-space joined 4-digit numbers', (random) => {
      return Array.from({ length: 6 }, () => 1000 + random(9000)).join(', ')
    }],
    ['16-digit numbers with comma thousands', (random) => {
      const digits = String(1 + random(9))
        + Array.from({ length: 15 }, () => random(10)).join('')

      return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }],
    ['three y/m/d dates', (random) => {
      return Array.from({ length: 3 }, () => {
        return `${2000 + random(26)}/${1 + random(12)}/${1 + random(28)}`
      }).join(' ')
    }],
    ['three zero-padded y/m/d dates', (random) => {
      return Array.from({ length: 3 }, () => {
        return `${2000 + random(26)}/${padded(1 + random(12))}/${padded(1 + random(28))}`
      }).join(' ')
    }],
  ])('flags none of %s', (_label, generate) => {
    expect(countFlagged(generate)).toBe(0)
  })
})

describe('sensitive-topic classifier evasions (audit finding 11)', () => {
  it.each<[string, string, MemorySensitiveCategory]>([
    [
      'a soft hyphen inside a word',
      `I was diagnosed with dia${SOFT_HYPHEN}betes`,
      'health',
    ],
    [
      'a zero-width space inside a word',
      `I was diag${ZERO_WIDTH_SPACE}nosed with diabetes`,
      'health',
    ],
    [
      'bidi override characters',
      `I am ${RIGHT_TO_LEFT_OVERRIDE}pregnant${POP_DIRECTIONAL_FORMATTING}`,
      'health',
    ],
    [
      'a stray combining mark',
      `I am preg${COMBINING_LOW_LINE}nant and due in March`,
      'health',
    ],
    ['unaccented Polish (pregnancy)', 'Jestem w ciazy', 'health'],
    ['unaccented Polish (hypertension)', 'Mam nadcisnienie', 'health'],
    [
      'unaccented Polish (trade union)',
      'Naleze do zwiazku zawodowego',
      'trade-union',
    ],
    ['a Latin i inside a Ukrainian word', 'У мене дiабет', 'health'],
    ['a Latin o and a inside a Ukrainian word', 'Я вагiтнa', 'health'],
    ['a precomposed accent', 'I have diabétes', 'health'],
    ['a decomposed accent', 'I have diabe\u0301tes', 'health'],
    ['a Cyrillic і inside a Latin word', 'I have hіv', 'health'],
    ['a Cyrillic а inside a Latin word', 'I am prеgnаnt', 'health'],
    ['the kept diacritic of heroinę', 'Brał heroinę w młodości', 'drugs'],
  ])('flags %s', (_label, text, category) => {
    expect(classifySensitiveCategories(text)).toContain(category)
    expect(evaluate(text)).toMatchObject({
      allowed: false,
      reason: 'sensitive-topic',
    })
  })

  it.each([
    ['an English heroine', 'Heroine of the story wins in the end'],
    ['unaccented Polish hope', 'Mam nadzieje, ze zdaze na pociag'],
    ['unaccented Polish work', 'Jestem w pracy do piatku'],
    ['a Polish code review', 'Robie przeglad kodu w czwartek'],
    ['a mixed Ukrainian sentence', 'Пишу код на TypeScript і Go'],
    ['a soft hyphen in a plain word', `Likes long-distance cyc${SOFT_HYPHEN}ling`],
    ['an accented plain word', 'Loves café crème and the Pokémon games'],
  ])('does not flag %s', (_label, text) => {
    expect(classifySensitiveCategories(text)).toEqual([])
  })
})

describe('topical never-store kinds on every write path (audit finding 12)', () => {
  it.each<[string, NeverStoreKind]>([
    ['Lives at 221B Baker Street, London', 'home-address'],
    ['My home address is 12 Baker Street', 'home-address'],
    ['Her address: 5 Oak Lane, Leeds', 'home-address'],
    ['Visited 10 Downing Street on a tour of 3 Elm Street', 'home-address'],
    ['Mieszka przy ul. Marszałkowskiej 12', 'home-address'],
    ['Mój adres: ul. Długa 5, Kraków', 'home-address'],
    ['Moj adres to Dluga 5 m. 3', 'home-address'],
    ['Mieszkam pod adresem Długa 5', 'home-address'],
    ['Живу за адресою вул. Хрещатик, 22', 'home-address'],
    ['Моя адреса: вул. Шевченка 5, кв. 3', 'home-address'],
    ['Waiting for my residence permit renewal', 'immigration-status'],
    ['Has a green card since 2020', 'immigration-status'],
    ['Applied for asylum last year', 'immigration-status'],
    ['Overstayed my visa in 2019', 'immigration-status'],
    ['Mam kartę pobytu czasowego', 'immigration-status'],
    ['Mam karte pobytu', 'immigration-status'],
    ['Ubiegam się o azyl', 'immigration-status'],
    ['Ma status UKR w Polsce', 'immigration-status'],
    ['Маю посвідку на тимчасове проживання', 'immigration-status'],
    ['Отримала тимчасовий захист у Польщі', 'immigration-status'],
    ['Has a criminal record', 'criminal-history'],
    ['He was convicted of fraud in 2015', 'criminal-history'],
    ['Served time in prison for theft', 'criminal-history'],
    ['Is out on parole', 'criminal-history'],
    ['Byłem karany za jazdę po pijanemu', 'criminal-history'],
    ['Bylem karany w przeszlosci', 'criminal-history'],
    ['Siedział w więzieniu dwa lata', 'criminal-history'],
    ['Маю судимість', 'criminal-history'],
    ['Він відбував покарання у колонії', 'criminal-history'],
    ['My work permit expires in March', 'immigration-status'],
    ['I have temporary protection in Poland', 'immigration-status'],
    ['Lives on 12 High Road, London', 'home-address'],
    ['Mieszkam przy Długiej 4', 'home-address'],
    ['Мешкаю за адресою Шевченка 5', 'home-address'],
  ])('rejects %j as %s with the unchanged never-store verdict',
    (text, kind) => {
      expect(detectTopicalNeverStoreKinds(text)).toContain(kind)

      const verdict = evaluate(text)

      expect(verdict.allowed).toBe(false)
      expect(verdict).toMatchObject({ reason: 'never-store' })
      expect((verdict as { kinds: NeverStoreKind[] }).kinds).toContain(kind)
    })

  it.each([
    'Building my address book app',
    'Loves the Criminal Minds TV show',
    'Reads the PESEL format docs',
    'Uses the IP address field in web forms',
    'My email address is on the profile page',
    'Lives in Warsaw with two cats',
    'A 5th Avenue fan who walks 3 miles a day',
    'Works on immigration law software',
    'Watched a documentary about asylum policy',
    'Probation period at the new job ends in May',
    'Released 3 apps last year',
    'Cites Smith et al. Nature 2019 often',
    'Calls os.path.join 3 times',
    'Pracuje nad aplikacją do książki adresowej',
    'Lubi serial o kryminalistach',
    'Mieszkam w Krakowie od 2019',
    'Mieszkam przy rodzicach od 2 lat',
    'Ulica ma 3 pasy ruchu',
    'Розробляю застосунок адресної книги',
    'Читаю документацію формату PESEL',
    'Живу у Львові з 2020 року',
    'Пише про засудження війни',
    'Займаюся документуванням депортації дітей',
    'На вулиці сьогодні 5 градусів',
    'I walked 5 miles down main street',
    '2 blocks from Wall Street',
    'Wants a work permit template for building site',
    'Reads a book about criminal records',
    'temporary protection for the plant',
    'visa status check app',
    'Has 3 kids and likes Elm Street movies',
    'Researches people seeking asylum in Europe',
    'Helps clients fill in residence permit forms',
    'Pomaga wypełniać wnioski o kartę pobytu',
    'Перевіряє судимість кандидатів',
    'Sprawdza karalność kandydatów',
    'He has a record of 3 wins',
  ])('allows %j', (text) => {
    expect(detectTopicalNeverStoreKinds(text)).toEqual([])
  })
})
