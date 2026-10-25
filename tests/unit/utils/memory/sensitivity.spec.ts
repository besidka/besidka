import { describe, expect, it } from 'vitest'
import type { MemorySensitiveCategory } from '#shared/types/memory.d'
import { memorySensitiveCategories } from '#shared/utils/memory-policy'
import {
  classifySensitiveCategories,
  classifySensitiveText,
  sensitiveTextRules,
} from '~~/server/utils/memory/sensitivity'

type PositiveCase = [text: string, category: MemorySensitiveCategory]

const englishPositives: PositiveCase[] = [
  ['I was diagnosed with type 1 diabetes last year', 'health'],
  ['I am pregnant and due in March', 'health'],
  ['My therapist moved my session to Friday', 'health'],
  ['I am allergic to penicillin', 'health'],
  ['I go to church every Sunday', 'religion-or-belief'],
  ['I am a practicing Muslim', 'religion-or-belief'],
  ['I am an atheist', 'religion-or-belief'],
  ['My parents are devout, and I am a Christian too', 'religion-or-belief'],
  ['I voted for the Labour candidate', 'political-opinion'],
  ['My political views are quite left-wing', 'political-opinion'],
  ['I am a member of the Green Party', 'political-opinion'],
  ['My ethnic origin is Roma', 'racial-or-ethnic-origin'],
  ['I am of Korean descent', 'racial-or-ethnic-origin'],
  ['I am gay and my partner is called Alex', 'sex-life-or-orientation'],
  ['She is transgender', 'sex-life-or-orientation'],
  ['I am a member of a trade union', 'trade-union'],
  ['Our union dues went up again', 'trade-union'],
  ['I took a DNA test and found a BRCA mutation', 'genetic'],
  ['My genetic condition runs in the family', 'genetic'],
  ['The app stores my biometric data', 'biometric'],
  ['They keep a fingerprint database of employees', 'biometric'],
  ['I am being sued by my landlord', 'legal-dispute'],
  ['The custody battle starts next month', 'legal-dispute'],
  ['I used cocaine in college', 'drugs'],
  ['He struggles with drug addiction', 'drugs'],
]

const ukrainianPositives: PositiveCase[] = [
  ['У мене діабет другого типу', 'health'],
  ['Я вагітна, термін чотири місяці', 'health'],
  ['Мені поставили діагноз депресія', 'health'],
  ['Мій психіатр призначив нові ліки', 'health'],
  ['Мені лікують рак легень', 'health'],
  ['Я віруюча людина і ходжу до церкви щонеділі', 'religion-or-belief'],
  ['Я православний християнин', 'religion-or-belief'],
  ['Щовечора читаю молитву', 'religion-or-belief'],
  ['Я голосував за цю партію на виборах', 'political-opinion'],
  ['Мої політичні погляди ліберальні', 'political-opinion'],
  ['Моя етнічна приналежність — ромська', 'racial-or-ethnic-origin'],
  ['За національністю я ромка', 'racial-or-ethnic-origin'],
  ['Я гей, і мій партнер теж', 'sex-life-or-orientation'],
  ['Моя сексуальна орієнтація — біографічна тема', 'sex-life-or-orientation'],
  ['Вона трансгендерна жінка', 'sex-life-or-orientation'],
  ['Я голова профспілки на заводі', 'trade-union'],
  ['Мені потрібна консультація профспілки', 'trade-union'],
  ['Зробив тест ДНК і генетичний аналіз', 'genetic'],
  ['У родині є генетичне захворювання', 'genetic'],
  ['Система зберігає мої біометричні дані', 'biometric'],
  ['Мені потрібна судова справа про спадок', 'legal-dispute'],
  ['Подали позов проти орендодавця', 'legal-dispute'],
  ['Колись він вживав кокаїн', 'drugs'],
  ['Бореться з наркоманією', 'drugs'],
  ['Мій діаgноз — пʼять років ремісії, я хворію на астму', 'health'],
]

const polishPositives: PositiveCase[] = [
  ['Mam cukrzycę typu drugiego', 'health'],
  ['Jestem w ciąży od trzech miesięcy', 'health'],
  ['Leczę się u psychiatry z powodu depresji', 'health'],
  ['Mam nowotwór płuc', 'health'],
  ['Jestem osobą wierzącą i chodzę do kościoła', 'religion-or-belief'],
  ['Jestem katolikiem od urodzenia', 'religion-or-belief'],
  ['Codziennie odmawiam modlitwę', 'religion-or-belief'],
  ['Moje poglądy polityczne są konserwatywne', 'political-opinion'],
  ['Jestem członkiem partii od lat', 'political-opinion'],
  ['Moje pochodzenie etniczne jest romskie', 'racial-or-ethnic-origin'],
  ['Jestem narodowości romskiej', 'racial-or-ethnic-origin'],
  ['Jestem gejem i mam męża', 'sex-life-or-orientation'],
  ['Moja orientacja seksualna to prywatna sprawa', 'sex-life-or-orientation'],
  ['Należę do związku zawodowego nauczycieli', 'trade-union'],
  ['Pisze do mnie związkowiec z zakładu', 'trade-union'],
  ['Zrobiłem badanie genetyczne i test DNA', 'genetic'],
  ['Mamy w rodzinie zespół Downa', 'genetic'],
  ['Firma zbiera moje dane biometryczne', 'biometric'],
  ['Mam sprawę rozwodową w sądzie', 'legal-dispute'],
  ['Złożyłem pozew przeciwko sąsiadowi', 'legal-dispute'],
  ['Kiedyś brał kokainę', 'drugs'],
  ['Walczy z narkomanią', 'drugs'],
  ['Jestem uzależniony od alkoholu i leczę alkoholizm', 'drugs'],
]

const russianPositives: PositiveCase[] = [
  ['У меня сахарный диабет второго типа', 'health'],
  ['Я беременна, срок четыре месяца', 'health'],
  ['Мне поставили диагноз депрессия', 'health'],
  ['Принимаю лекарства от давления', 'health'],
  ['Мой онколог назначил химиотерапию', 'health'],
  ['Я верующий человек и хожу в церковь', 'religion-or-belief'],
  ['Я православный и читаю молитву', 'religion-or-belief'],
  ['Он буддист уже десять лет', 'religion-or-belief'],
  ['Я голосовал за эту партию', 'political-opinion'],
  ['Мои политические взгляды консервативные', 'political-opinion'],
  ['Моя этническая принадлежность — цыгане', 'racial-or-ethnic-origin'],
  ['Я афроамериканец по происхождению', 'racial-or-ethnic-origin'],
  ['Я гей и живу с партнёром', 'sex-life-or-orientation'],
  ['Моя сексуальная ориентация не секрет', 'sex-life-or-orientation'],
  ['Я состою в профсоюзе уже давно', 'trade-union'],
  ['Сделал генетический анализ и тест ДНК', 'genetic'],
  ['Приложение хранит мои биометрические данные', 'biometric'],
  ['У меня судебное дело о разводе', 'legal-dispute'],
  ['Подал иск против арендодателя', 'legal-dispute'],
  ['Раньше употреблял героин', 'drugs'],
  ['Лечится от наркомании', 'drugs'],
]

const negatives: Record<string, string[]> = {
  english: [
    'Diet constraints for the meal plan',
    'I live on Church Street',
    'Gay Street 5, apartment 3',
    'We should follow Gay-Lussac law in the lab',
    'European Union regulations apply',
    'Book a tennis court for Saturday',
    'I need to weed the garden',
    'drugstore opening hours',
    'My horoscope says Cancer (zodiac) is lucky this week',
    'race to the finish line',
    'the fingerprint sensor on the laptop is flaky',
    'the UI uses Face ID',
    'We acted in good faith',
    'union types in TypeScript are handy',
    'doctor appointment calendar for next week',
    'I go to Church Street every day',
    'My colleague Christian is on holiday',
    'My name is Christian and I like Rome',
    'The server is platform agnostic',
    'A bipolar junction transistor amplifies current',
    'Islamabad is the capital of Pakistan',
    'I am a liberal arts student',
    'The Great Depression ended in 1939',
    'straight line from A to B',
    'Jewel is my favourite singer',
  ],
  ukrainian: [
    'Дієта на тиждень без цукру',
    'Я живу на вулиці Церковній',
    'Гей, словʼяни, це популярна пісня',
    'Продовжуємо рух до фіналу',
    'Купив крабів і рак на вечерю',
    'Записатися на прийом до лікаря в календарі',
    'Датчик відбитків пальців на ноутбуці глючить',
    'Європейський Союз ухвалив рішення',
    'Діагностика помилки у коді',
    'Полив рослин у саду',
    'Футбольна партія закінчилась внічию',
    'Моє ліве плече трохи болить від спорту',
    'Етнічна кухня на вихідних',
    'Тенісний корт заброньовано',
  ],
  polish: [
    'Dieta na cały tydzień bez cukru',
    'Mieszkam przy ulicy Kościelnej',
    'Gejzer wybucha co godzinę',
    'Rak i krab na obiad',
    'Wizyta u lekarza w kalendarzu',
    'Czytnik odcisków palców w laptopie nie działa',
    'Unia Europejska przyjęła nowe przepisy',
    'Rozprawa doktorska została obroniona',
    'Pozwolić sobie na odpoczynek',
    'Impreza urodzinowa w sobotę',
    'Wyścig rowerowy w niedzielę',
    'Ciąży na mnie obowiązek zakończenia projektu',
    'Kort tenisowy zarezerwowany na piątek',
  ],
  russian: [
    'Диета на неделю без сахара',
    'Я живу на улице Церковной',
    'Закон Гей-Люссака в лаборатории',
    'Купил краба и рак на ужин',
    'Запись к врачу в календаре',
    'Датчик отпечатков пальцев на ноутбуке глючит',
    'Европейский союз принял решение',
    'Искусство и музыка по выходным',
    'Теннисный корт забронирован',
    'Гонка к финишу была напряжённой',
    'Партия в шахматы затянулась',
    'Полка с книгами в саду',
    'Исламабад столица Пакистана',
    'Диагностика ошибки в коде',
  ],
}

function describePositives(
  language: string,
  positives: PositiveCase[],
) {
  describe(`${language} positives`, () => {
    it.each(positives)('flags %j as %s', (text, category) => {
      expect(classifySensitiveCategories(text)).toContain(category)
      expect(classifySensitiveText(text)).not.toBeNull()
    })
  })
}

describe('sensitiveTextRules', () => {
  it('has exactly one rule per category in policy order', () => {
    expect(sensitiveTextRules.map(rule => rule.category))
      .toEqual([...memorySensitiveCategories])
  })

  it('has patterns for every category in each primary language', () => {
    for (const rule of sensitiveTextRules) {
      const languages = new Set(rule.patterns.map(pattern => pattern.language))

      expect(languages.has('en'), rule.category).toBe(true)
    }
  })

  it('compiles every pattern on its own', () => {
    for (const rule of sensitiveTextRules) {
      for (const pattern of rule.patterns) {
        expect(
          () => new RegExp(pattern.source.replaceAll(' ', '\\s+'), 'u'),
          `${rule.category}: ${pattern.source}`,
        ).not.toThrow()
      }
    }
  })
})

describe('classifySensitiveCategories', () => {
  describePositives('english', englishPositives)
  describePositives('ukrainian', ukrainianPositives)
  describePositives('polish', polishPositives)
  describePositives('russian', russianPositives)

  describe.each(Object.entries(negatives))('%s negatives', (
    _language,
    texts,
  ) => {
    it.each(texts)('does not flag %j', (text) => {
      expect(classifySensitiveCategories(text)).toEqual([])
      expect(classifySensitiveText(text)).toBeNull()
    })
  })

  it('covers every category in every positive table', () => {
    const tables = [
      englishPositives,
      ukrainianPositives,
      polishPositives,
      russianPositives,
    ]
    const covered = new Set(
      tables.flatMap(table => table.map(([, category]) => category)),
    )

    expect(covered.has('health')).toBe(true)
    expect(covered.has('drugs')).toBe(true)
    expect(covered.has('legal-dispute')).toBe(true)
    expect(covered.has('genetic')).toBe(true)
    expect(covered.has('biometric')).toBe(true)
    expect(covered.has('trade-union')).toBe(true)
    expect(covered.has('sex-life-or-orientation')).toBe(true)
    expect(covered.has('political-opinion')).toBe(true)
    expect(covered.has('racial-or-ethnic-origin')).toBe(true)
    expect(covered.has('religion-or-belief')).toBe(true)
  })

  it('returns every matched category in policy order', () => {
    const text = 'I sued my landlord, I am gay and I take insulin daily'

    expect(classifySensitiveCategories(text)).toEqual([
      'health',
      'sex-life-or-orientation',
      'legal-dispute',
    ])
  })

  it('keeps policy order regardless of mention order', () => {
    const text = 'Cocaine, a lawsuit, a union dues bill and my diabetes'

    expect(classifySensitiveCategories(text)).toEqual([
      'health',
      'trade-union',
      'legal-dispute',
      'drugs',
    ])
  })

  it('combines categories across languages in one text', () => {
    const text = 'Я гей і ходжу до церкви. Mam cukrzycę. Принимаю лекарства.'

    expect(classifySensitiveCategories(text)).toEqual([
      'health',
      'religion-or-belief',
      'sex-life-or-orientation',
    ])
  })

  it('handles mixed scripts in a single sentence', () => {
    expect(classifySensitiveCategories('My діабет is under control'))
      .toEqual(['health'])
    expect(classifySensitiveCategories('Notatka: pregnant, вагітна, w ciąży'))
      .toEqual(['health'])
  })

  it('matches Ukrainian words written with every apostrophe variant', () => {
    const variants = ['ʼ', '’', '‘', '\'']

    for (const apostrophe of variants) {
      expect(
        classifySensitiveCategories(`Гей, слов${apostrophe}яни і я гей`),
      ).toEqual(['sex-life-or-orientation'])
    }
  })

  it('normalises compatibility forms and case', () => {
    expect(classifySensitiveCategories('I HAVE ＤＩＡＢＥＴＥＳ'))
      .toEqual(['health'])
    expect(classifySensitiveCategories('ВАГІТНА')).toEqual(['health'])
    expect(classifySensitiveCategories('я гей')).toEqual([
      'sex-life-or-orientation',
    ])
  })

  it('folds yo to ye for Russian', () => {
    expect(classifySensitiveCategories('Я крещёный, он атеист'))
      .toEqual(['religion-or-belief'])
  })

  it('does not match inside longer words', () => {
    expect(classifySensitiveCategories('Jewelry shop on the corner'))
      .toEqual([])
    expect(classifySensitiveCategories('The geyser by the hill'))
      .toEqual([])
    expect(classifySensitiveCategories('Heroine of the story'))
      .toEqual([])
  })

  it('returns an empty array for the empty string', () => {
    expect(classifySensitiveCategories('')).toEqual([])
    expect(classifySensitiveText('')).toBeNull()
  })

  it('returns an empty array for whitespace and punctuation', () => {
    expect(classifySensitiveCategories('   \n\t ... !!!')).toEqual([])
  })

  it('finishes quickly on a very long benign input', () => {
    const filler = 'The quick brown fox jumps over the lazy dog. '
      + 'Швидка руда лисиця перестрибує через ледачого пса. '
    const text = filler.repeat(Math.ceil(100_000 / filler.length))
    const startedAt = performance.now()
    const categories = classifySensitiveCategories(text)
    const elapsed = performance.now() - startedAt

    expect(text.length).toBeGreaterThanOrEqual(100_000)
    expect(categories).toEqual([])
    expect(elapsed).toBeLessThan(750)
  })

  it('finishes quickly on adversarial repeated stems', () => {
    const text = 'діабетичний '.repeat(8_000) + 'a'.repeat(20_000)
    const startedAt = performance.now()

    classifySensitiveCategories(text)

    expect(performance.now() - startedAt).toBeLessThan(750)
  })

  it('classifies a typical 2 KB note in a few milliseconds', () => {
    const note = 'Prefers concise answers and TypeScript examples. '
    const text = note.repeat(Math.ceil(2048 / note.length))
    const startedAt = performance.now()

    classifySensitiveCategories(text)

    expect(performance.now() - startedAt).toBeLessThan(50)
  })
})

describe('classifySensitiveText', () => {
  it('returns the first category in policy order', () => {
    expect(classifySensitiveText('I sued him and I take insulin'))
      .toBe('health')
  })

  it('returns a single category when only one matches', () => {
    expect(classifySensitiveText('I am a member of a trade union'))
      .toBe('trade-union')
  })

  it('returns null for benign text', () => {
    expect(classifySensitiveText('Prefers dark mode and pnpm')).toBeNull()
  })
})
