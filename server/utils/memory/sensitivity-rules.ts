import type { MemorySensitiveCategory } from '#shared/types/memory.d'

export type SensitiveTextLanguage = 'en' | 'uk' | 'pl' | 'ru' | 'uk-ru' | 'any'

export interface SensitiveTextPattern {
  language: SensitiveTextLanguage
  source: string
  examples: string[]
}

export interface SensitiveTextRule {
  category: MemorySensitiveCategory
  patterns: readonly SensitiveTextPattern[]
}

export const sensitiveWordStart = String.raw`(?<![\p{L}\p{N}])`
export const sensitiveWordEnd = String.raw`(?![\p{L}\p{N}])`

const WORD_END = sensitiveWordEnd

const I_AM = String.raw`i(?:'?m| am)`

const STREET_WORDS_EN = 'street|st|road|rd|avenue|ave|lane|ln|square|sq|hill'
  + '|way|drive|dr|park|end|boulevard|blvd'
const STREET_WORDS_PL = 'ulic\\p{L}*|ul|alej\\p{L}*|al|plac\\p{L}*|pl'
  + '|osiedl\\p{L}*|rondo'

const NOT_STREET_EN = String.raw`(?![-\s]+(?:${STREET_WORDS_EN})${WORD_END})`
const NOT_STREET_PL = String.raw`(?![-\s]+(?:${STREET_WORDS_PL})${WORD_END})`

const NOT_PSYCHOLOGY_CYRILLIC = String.raw`(?!ия|ии|ию|ией|ія|ії|ію|ією)`

const BARE_CLAUSE_END = String.raw`\s*(?:[.,;:!?)\n]|$)`

function createClauseEnd(connectors: string, pronouns: string, extras: string) {
  return String.raw`(?=${BARE_CLAUSE_END}|\s+(?:(?:${connectors}) (?:${pronouns})|${extras})${WORD_END})`
}

const CLAUSE_END_EN = createClauseEnd(
  'and|but',
  'i|my|we|our',
  'myself|too',
)
const IDEOLOGY_END_EN = createClauseEnd(
  'and|but',
  'i|my|we|our',
  'in politics|politically|at heart|by conviction',
)
const IDEOLOGY_END_UK = createClauseEnd(
  'і|та|але|а',
  'я|мій|моя|ми',
  'у політиці|політично|за переконаннями',
)
const IDEOLOGY_END_PL = createClauseEnd(
  'i|ale|a',
  'ja|mój|moja|my',
  'w polityce|politycznie|z przekonania',
)
const IDEOLOGY_END_RU = createClauseEnd(
  'и|но|а',
  'я|мой|моя|мы',
  'в политике|политически|по убеждениям',
)

const POLITICAL_NOUNS_EN = String.raw`parties|party|candidates?|elections?`
  + String.raw`|president\p{L}*|parliament\p{L}*|referendum|senator|mayor`
  + String.raw`|governor|prime minister|labou?r|tor(?:y|ies)|democrats`
  + String.raw`|republicans|conservatives|greens|libertarians`

const DIAGNOSED_CONDITIONS_EN = String.raw`lupus|ibs|irritable bowel|arthritis`
  + String.raw`|fibromyalgia|psoriasis|eczema|copd|leuk(?:a)?emia|lymphoma`
  + String.raw`|melanoma|tumou?r|cancer|an(?:a)?emia|hepatitis|tuberculosis`
  + String.raw`|covid|disorder|disease|syndrome|illness|condition`
  + String.raw`|sleep apn(?:o)?ea|neuropathy|osteoporosis|hypothyroidism`
  + String.raw`|hyperthyroidism|glaucoma|diabetes|depression|anxiety|adhd`
  + String.raw`|autism|ptsd|ocd|ms`

const CRIME_WORDS_EN = String.raw`theft|fraud|assault|murder|manslaughter`
  + String.raw`|burglary|robbery|arson|drunk driving|drink driving|dui|dwi`
  + String.raw`|tax evasion|embezzlement|battery|kidnapping|trespassing`
  + String.raw`|homicide|rape|a crime|a felony|a misdemeanou?r`
  + String.raw`|(?:drug )?possession|vandalism|stalking|harassment`

const MEDICAL_STEMS_UK = String.raw`діабет|астм|епілеп|депресі|шизофрені`
  + String.raw`|гіпертоні|мігрен|псоріаз|артрит|анемі|лейкоз|туберкульоз`
  + String.raw`|гепатит|алергі|подагр|цукров|рак(?:а|у|ом)?|онколог`

const MEDICAL_STEMS_PL = String.raw`cukrzyc|astm|padaczk|depresj|schizofreni`
  + String.raw`|nowotw|raka?|nadciśnien|migren|białaczk|stwardnien|zapaleni`
  + String.raw`|autyzm|alzheimer|parkinson|chorob`

function createPattern(language: SensitiveTextLanguage) {
  return (strings: TemplateStringsArray, ...values: string[]) => {
    const source = String.raw(strings, ...values)

    return (examples: string[]): SensitiveTextPattern => {
      return { language, source, examples }
    }
  }
}

const en = createPattern('en')
const uk = createPattern('uk')
const pl = createPattern('pl')
const ru = createPattern('ru')
const ukRu = createPattern('uk-ru')
const any = createPattern('any')

/**
 * Deterministic GDPR Art. 9 vocabulary, one rule per category in the order of
 * `memorySensitiveCategories`. Sources are matched against NFKC-lowercased
 * text with straight apostrophes and `ё` folded to `е`; a space in a source
 * means "one or more whitespace", every source is wrapped in Unicode-aware
 * word boundaries (`\b` does not work for Cyrillic or Polish), and a trailing
 * `\p{L}*` is an inflection stem. Words that are also ordinary vocabulary
 * (diet, church, party, weed, race, union, court, DNA, Face ID, rak, drug use,
 * vote, orthodox, hindu, jewish, psychologist, ramadan) never match on their
 * own: they need a personal frame ("I am", "my") or an unambiguous companion
 * noun. Every pattern carries `examples` it must match, which the spec
 * verifies against the compiled expression.
 */
export const sensitiveTextRuleTable: readonly SensitiveTextRule[] = [
  {
    category: 'health',
    patterns: [
      en`diabet\p{L}*`(['I have diabetes', 'My son is diabetic']),
      any`hiv`(['I am living with HIV']),
      en`(?<!great )depress(?:ion|ed|ive)`([
        'I struggle with depression',
        'I felt depressed for months',
      ]),
      en`(?:i have|i've got|i suffer from|my|social|generalized|generalised) anxiety`([
        'I have anxiety before exams',
        'I live with social anxiety',
      ]),
      en`anxiety disorders?`(['She has an anxiety disorder']),
      en`panic attacks?`(['I get panic attacks on the subway']),
      en`bipolar (?:disorder|depression|i|ii)`(['He has bipolar disorder']),
      en`${I_AM} bipolar`(['I am bipolar']),
      en`schizophreni\p{L}*`(['My brother has schizophrenia']),
      any`ptsd`(['I deal with PTSD']),
      en`post[-\s]traumatic stress`(['Post-traumatic stress after the crash']),
      any`ocd`(['I have OCD']),
      any`adhd`(['I was diagnosed with ADHD as an adult']),
      en`autis(?:m|tic)`(['My daughter is autistic']),
      en`asthma\p{L}*`(['I have asthma']),
      en`epilep\p{L}*`(['I have epilepsy']),
      en`(?:breast|lung|prostate|skin|colon|bowel|liver|blood|bone|brain|ovarian|cervical|pancreatic|thyroid|stomach|kidney) cancer`([
        'My mother has breast cancer',
      ]),
      en`(?:have|has|had|having|fighting|beat|beating|survived|battling|battle with|living with) cancer(?![-\s]+(?:zodiac|sign|horoscope|season))`([
        'I had cancer two years ago',
        'My father is fighting cancer',
      ]),
      en`cancer (?:diagnosis|patient|survivor|treatment|screening)`([
        'I am a cancer survivor',
      ]),
      en`(?:brain|benign|malignant) tumou?rs?`(['They found a benign tumour']),
      en`chemotherapy`(['I start chemotherapy on Monday']),
      en`oncolog\p{L}*`(['My oncologist changed the plan']),
      en`diagnosed with (?:an? |the )?(?:(?:type \d|chronic|severe|mild|early[-\s]stage|rare|autoimmune) )?(?:${DIAGNOSED_CONDITIONS_EN})`([
        'I was diagnosed with lupus',
        'She was diagnosed with a rare condition',
        'diagnosed with type 2 diabetes',
      ]),
      en`medical diagnos\p{L}*`(['I need a medical diagnosis letter']),
      en`chronic (?:illness|illnesses|disease|diseases|pain|condition|conditions|fatigue|migraines?)`([
        'I live with chronic pain',
        'Chronic fatigue makes mornings hard',
      ]),
      en`therap(?:y|ies|ist|ists)`(['My therapist moved my session']),
      en`psychiatr\p{L}*`(['I see a psychiatrist monthly']),
      en`psychotherap\p{L}*`(['Weekly psychotherapy helps']),
      en`(?:(?:i )?see|saw|seeing|visit|visited|visiting|consult|consulted|consulting|go to|went to|going to|started seeing|my) (?:an? |the |my )?(?:\p{L}+ )?psychologists?`([
        'I see a psychologist on Tuesdays',
        'My psychologist is on holiday',
      ]),
      en`mental health`(['I struggle with my mental health']),
      en`eating disorders?`(['She recovered from an eating disorder']),
      en`anorexia nervosa|bulimia`(['I have anorexia nervosa']),
      en`pregnan\p{L}*`(['I am pregnant']),
      en`allerg\p{L}*`(['I am allergic to penicillin']),
      en`medications?`(['I take medication every morning']),
      en`antidepressants?`(['I am on antidepressants']),
      en`insulin`(['I take insulin daily']),
      en`migraines?`(['I get migraines']),
      en`(?:i have|i've got|i am living with|my|he has|she has) (?:a |an )?(?:\p{L}+ )?disabilit(?:y|ies)`([
        'I have a physical disability',
      ]),
      en`disability (?:benefits?|pension|status|certificate|allowance|card)`([
        'My disability benefits were cut',
      ]),
      en`wheelchair`(['I use a wheelchair']),
      en`celiac|coeliac`(['I have celiac disease']),
      en`(?:lactose|gluten) intoleran\p{L}*`(['I have lactose intolerance']),
      en`crohn'?s`(['I have Crohn\'s']),
      en`dyslexi\p{L}*`(['I have dyslexia']),
      en`tourette\p{L}*`(['I have Tourette\'s']),
      en`multiple sclerosis`(['My aunt has multiple sclerosis']),
      en`alzheimer\p{L}*`(['My dad has Alzheimer\'s']),
      en`dementia`(['My grandmother has dementia']),
      en`hypertension`(['I take pills for hypertension']),
      en`high blood pressure`(['I have high blood pressure']),
      en`heart (?:disease|condition)`(['I have a heart condition']),
      en`(?:had|have|having|suffered|survived|suffered from|got) (?:a |my )?(?:mild |massive |minor |second )?heart attack`([
        'My dad had a heart attack last year',
      ]),
      en`miscarriage`(['We went through a miscarriage']),
      en`infertility`(['We struggle with infertility']),
      en`(?:had|have|having|undergo|undergoing|upcoming|knee|heart|eye|back) surgery`([
        'I have surgery next week',
        'Recovering after knee surgery',
      ]),
      en`(?:${I_AM} (?:currently |now )?(?:on|taking)|i (?:took|take|went on|was on)|i'?m going on) (?:a |my )?sick leave`([
        'I am on sick leave until Friday',
        'I took sick leave last month',
      ]),
      en`sexually transmitted`(['I tested for a sexually transmitted infection']),
      uk`діабет\p{L}*`(['У мене діабет другого типу']),
      uk`депресі\p{L}*`(['Я лікуюсь від депресії']),
      uk`депресивн\p{L}*`(['У мене депресивний епізод']),
      uk`тривожн\p{L}* розлад\p{L}*`(['У мене тривожний розлад']),
      uk`біполярн\p{L}* розлад\p{L}*`(['У нього біполярний розлад']),
      uk`шизофрені\p{L}*`(['У брата шизофренія']),
      ukRu`аутизм\p{L}*|аутист\p{L}*`(['У сина аутизм']),
      ukRu`сдвг|адгд`(['У мене СДВГ']),
      uk`вагітн\p{L}*`(['Я вагітна, термін чотири місяці']),
      uk`алерг\p{L}*`(['У мене алергія на пеніцилін']),
      uk`діагноз\p{L}*`(['Мій діагноз — п\'ять років ремісії']),
      uk`хронічн\p{L}* (?:хвороб|захворюван|біль)\p{L}*`([
        'У мене хронічна хвороба',
      ]),
      uk`психіатр\p{L}*`(['Мій психіатр призначив нові ліки']),
      uk`психотерап\p{L}*`(['Ходжу на психотерапію']),
      uk`терапі\p{L}*`(['Я на терапії другий рік']),
      uk`(?:ходжу|ходив\p{L}*|ходила|ходимо|зверн\p{L}*|запис\p{L}*|відвідую) до (?:\p{L}+ )?психолог${NOT_PSYCHOLOGY_CYRILLIC}\p{L}*`([
        'Я ходжу до психолога щотижня',
        'Вона звернулась до дитячого психолога',
      ]),
      uk`(?:мій|мого|моєму|моїм|моя|моєї|моїй|мою) (?:\p{L}+ )?психолог${NOT_PSYCHOLOGY_CYRILLIC}\p{L}*`([
        'Мій психолог у відпустці',
        'Моя психологиня порадила паузу',
      ]),
      ukRu`онколог\p{L}*`(['Мій онколог призначив обстеження']),
      uk`рак(?:у|а|ом)? (?:легень|легенів|грудей|молочної залози|простати|шкіри|шлунка|крові|мозку|печінки|товстої кишки|підшлункової)`([
        'Мені лікують рак легень',
        'Лікуюсь від раку грудей',
      ]),
      uk`(?:у|в) мене (?:є )?рак(?:а|у|ом)?`(['У мене рак']),
      uk`(?:діагностува\p{L}*|виявил\p{L}*|лікуюс\p{L}*|лікую|боюс\p{L}*|одужую|переміг\p{L}*) (?:у мене |мені |від |на )?рак(?:а|у|ом)?`([
        'Мені діагностували рак',
        'Лікуюсь від раку',
      ]),
      uk`хіміотерапі\p{L}*`(['Я на хіміотерапії']),
      uk`пухлин\p{L}*`(['У мене доброякісна пухлина']),
      uk`віл`(['Я живу з ВІЛ']),
      uk`інсулін\p{L}*`(['Я колю інсулін']),
      uk`антидепресант\p{L}*`(['Я п\'ю антидепресанти']),
      uk`інвалід\p{L}*`(['У мене інвалідність']),
      uk`епілеп\p{L}*`(['У мене епілепсія']),
      uk`астм\p{L}*`(['У мене астма']),
      uk`мігрен\p{L}*`(['У мене мігрені']),
      uk`панічн\p{L}* атак\p{L}*`(['У мене панічні атаки']),
      uk`психічн\p{L}* (?:здоров|розлад|захворюван)\p{L}*`([
        'Піклуюсь про психічне здоров\'я',
      ]),
      uk`хвор\p{L}* на (?:${MEDICAL_STEMS_UK})\p{L}*`([
        'Я хворію на астму',
        'Мій батько хворий на діабет',
      ]),
      uk`прийма\p{L}* (?:ліки|таблетк\p{L}*)`(['Я приймаю ліки від тиску']),
      uk`препарат\p{L}* від (?:тиску|діабету|депресії|гіпертонії|астми|алергії|епілепсії|мігрені)`([
        'Приймаю препарат від тиску',
      ]),
      uk`розлад\p{L}* харчової поведінки`(['У мене розлад харчової поведінки']),
      pl`cukrzyc\p{L}*`(['Mam cukrzycę typu drugiego']),
      pl`depresj\p{L}*|depresyjn\p{L}*`(['Leczę się z powodu depresji']),
      pl`zaburzen\p{L}* (?:lęk|afekt|odżywi|psychicz|osobow)\p{L}*`([
        'Mam zaburzenia lękowe',
      ]),
      pl`chorob\p{L}* (?:serc|nerek|wątrob|tarczyc|psychiczn|autoimmunolog|przewlekł|genetyczn)\p{L}*`([
        'Mam chorobę serca',
      ]),
      pl`przewlekle chor\p{L}*`(['Jestem przewlekle chory']),
      pl`nowotw\p{L}*`(['Mam nowotwór płuc']),
      pl`chemioterapi\p{L}*`(['Zaczynam chemioterapię']),
      pl`onkolog\p{L}*`(['Mój onkolog zmienił plan']),
      pl`rak(?:a|iem|u|owi)? (?:płuc|piersi|prostaty|skóry|żołądka|jelita|krwi|mózgu|wątroby|trzustki|jajnika|tarczycy)`([
        'Mam raka piersi',
        'Rak płuc w rodzinie',
      ]),
      pl`(?:mam|ma|miał|miała|choruję na|boję się|leczę|wykryto u (?:mnie|niej|niego)|wykryli u mnie|zdiagnozowano u (?:mnie|niej|niego)|pokonałem|pokonałam) raka`([
        'Wykryto u mnie raka płuc',
        'Mam raka',
      ]),
      pl`padaczk\p{L}*`(['Mam padaczkę']),
      pl`astm\p{L}*`(['Mam astmę']),
      pl`autyzm\p{L}*|autystycz\p{L}*`(['Mój syn ma autyzm']),
      pl`w ciąży|ciąża|ciążow\p{L}*|ciężarn\p{L}*`(['Jestem w ciąży od trzech miesięcy']),
      pl`alerg\p{L}*|uczulen\p{L}*`(['Mam alergię na orzechy']),
      pl`psychiatr\p{L}*`(['Leczę się u psychiatry']),
      pl`psychoterap\p{L}*`(['Chodzę na psychoterapię']),
      pl`terapi\p{L}*|terapeut\p{L}*`(['Mój terapeuta jest super']),
      pl`(?:chodzę|chodziłem|chodziłam|byłem|byłam|idę|umówiłem się|umówiłam się) (?:do|u) (?:\p{L}+ )?psycholog(?!ia|ii|ię|ią)\p{L}*`([
        'Chodzę do psychologa raz w tygodniu',
        'Byłem u psychologa dziecięcego',
      ]),
      pl`(?:mój|moj\p{L}*) (?:\p{L}+ )?psycholog(?!ia|ii|ię|ią)\p{L}*`([
        'Mój psycholog jest na urlopie',
      ]),
      pl`zdiagnozowa\p{L}* (?:u (?:mnie|niej|niego|dziecka)|mi|z)|(?:mam|ma) zdiagnozowan\p{L}*`([
        'Zdiagnozowano u mnie depresję',
        'Mam zdiagnozowaną cukrzycę',
      ]),
      pl`diagnoz\p{L}* (?:lekarsk|medyczn)\p{L}*`(['Mam diagnozę lekarską']),
      pl`(?:bior\p{L}*|przyjmuj\p{L}*) leki`(['Biorę leki na ciśnienie']),
      pl`antydepresant\p{L}*`(['Biorę antydepresanty']),
      pl`insulin\p{L}*`(['Biorę insulinę']),
      pl`niepełnosprawn\p{L}*`(['Mam stopień niepełnosprawności']),
      pl`migren\p{L}*`(['Mam migrenę']),
      pl`ataki paniki|atak paniki`(['Mam ataki paniki']),
      pl`stwardnienie rozsiane`(['Mam stwardnienie rozsiane']),
      pl`nadciśnien\p{L}*`(['Mam nadciśnienie']),
      pl`celiaki\p{L}*`(['Mam celiakię']),
      pl`nietolerancj\p{L}* (?:laktoz|glutenu)\p{L}*`(['Mam nietolerancję laktozy']),
      pl`wózek inwalidzki|wózku inwalidzkim`(['Poruszam się na wózku inwalidzkim']),
      pl`poronieni\p{L}*`(['Przeszłam poronienie']),
      pl`niepłodn\p{L}*`(['Walczymy z niepłodnością']),
      pl`zwolnieni\p{L}* lekarsk\p{L}*`(['Jestem na zwolnieniu lekarskim']),
      pl`chor\p{L}* na (?:${MEDICAL_STEMS_PL})\p{L}*`([
        'Jestem chory na cukrzycę',
        'Moja mama jest chora na raka',
      ]),
      ru`диабет\p{L}*`(['У меня сахарный диабет второго типа']),
      ru`депресс\p{L}*`(['У меня депрессия']),
      ru`тревожн\p{L}* расстройств\p{L}*`(['У меня тревожное расстройство']),
      ru`биполярн\p{L}* расстройств\p{L}*`(['У него биполярное расстройство']),
      ru`шизофрени\p{L}*`(['У брата шизофрения']),
      ru`беременн\p{L}*`(['Я беременна, срок четыре месяца']),
      ru`аллерг\p{L}*`(['У меня аллергия на пенициллин']),
      ru`диагноз\p{L}*`(['Мне поставили диагноз депрессия']),
      ru`хроническ\p{L}* (?:болезн|заболеван|боль)\p{L}*`([
        'У меня хроническое заболевание',
      ]),
      ru`психиатр\p{L}*`(['Мой психиатр назначил лечение']),
      ru`психотерап\p{L}*`(['Хожу на психотерапию']),
      ru`терапи\p{L}*`(['Я на терапии второй год']),
      ru`(?:хожу|ходил\p{L}*|обратил\p{L}*|записал\p{L}*|записываюсь|посещаю) (?:к|у) (?:\p{L}+ )?психолог${NOT_PSYCHOLOGY_CYRILLIC}\p{L}*`([
        'Я хожу к психологу каждую неделю',
        'Обратилась к детскому психологу',
      ]),
      ru`мо(?:й|его|ему|им|я|ей|ю) (?:\p{L}+ )?психолог${NOT_PSYCHOLOGY_CYRILLIC}\p{L}*`([
        'Мой психолог в отпуске',
        'Моя психологиня посоветовала паузу',
      ]),
      ru`рак(?:а|у|ом|е)? (?:легк\p{L}*|груд\p{L}*|простат\p{L}*|кож\p{L}*|желудк\p{L}*|кров\p{L}*|мозг\p{L}*|печен(?:и|ью|ь)|кишечник\p{L}*|молочн\p{L}* желез\p{L}*|поджелудочн\p{L}*)`([
        'Лечусь от рака легких',
        'Боюсь рака груди',
      ]),
      ru`у меня (?:есть )?рак(?:а|ом)?`(['У меня рак']),
      ru`(?:диагностир\p{L}*|обнаруж\p{L}*|боюсь|лечусь|лечу|болею|победил\p{L}*) (?:у меня |мне |от )?рак(?:а|ом)?`([
        'Мне диагностировали рак',
        'Лечусь от рака',
      ]),
      ru`химиотерапи\p{L}*`(['Я на химиотерапии']),
      ru`опухол\p{L}*`(['У меня доброкачественная опухоль']),
      ru`вич`(['Я живу с ВИЧ']),
      ru`инсулин\p{L}*`(['Я колю инсулин']),
      ru`антидепрессант\p{L}*`(['Я пью антидепрессанты']),
      ru`инвалид\p{L}*`(['У меня инвалидность']),
      ru`эпилепс\p{L}*`(['У меня эпилепсия']),
      ru`астм\p{L}*`(['У меня астма']),
      ru`мигрен\p{L}*`(['У меня мигрени']),
      ru`панически\p{L}* атак\p{L}*`(['У меня панические атаки']),
      ru`психическ\p{L}* (?:здоровь|расстройств|заболеван)\p{L}*`([
        'Заботюсь о психическом здоровье',
      ]),
      ru`принима\p{L}* (?:лекарств|таблетк)\p{L}*`([
        'Принимаю лекарства от давления',
      ]),
      ru`препарат\p{L}* от (?:давления|диабета|депрессии|гипертонии|астмы|аллергии|эпилепсии|мигрени)`([
        'Принимаю препарат от давления',
      ]),
      ru`расстройств\p{L}* пищевого поведения`(['У меня расстройство пищевого поведения']),
    ],
  },
  {
    category: 'religion-or-belief',
    patterns: [
      en`christianity|christians`(['Christians in my town meet weekly']),
      en`${I_AM} (?:an? )?(?:devout |practicing |born[-\s]again |orthodox )?christian`([
        'I am a Christian',
        'I\'m a devout Christian',
      ]),
      en`(?:is|was|are|were|as) an? christian|raised (?:as )?(?:an? )?christian`([
        'I was raised as a Christian',
      ]),
      en`christian (?:faith|beliefs?|church|values|family|upbringing|denomination|community)`([
        'My Christian faith matters to me',
      ]),
      en`born[-\s]again`(['She is a born-again believer']),
      en`catholic\p{L}*`(['I am Catholic']),
      en`protestant\p{L}*`(['We are Protestant']),
      en`muslims?|moslems?`(['I am a practicing Muslim']),
      en`islam(?![-\s]*abad)\p{L}*`(['I converted to Islam']),
      en`judaism`(['I practice Judaism']),
      en`(?:jewish (?:faith|religion|community|family|holidays?|heritage|identity)|(?:my|his|her|our) jewish|${I_AM} (?:an? )?(?:practicing |observant )?jewish)`([
        'My Jewish family lights candles',
        'I am Jewish',
      ]),
      en`${I_AM} (?:an? )?(?:devout |practicing |practising |observant |strict |modern )?(?:hindu|jewish|jew|orthodox)${CLAUSE_END_EN}`([
        'I\'m Orthodox',
        'I am a Jew.',
        'I am Hindu and my family prays daily',
      ]),
      en`buddhis\p{L}*`(['I am a Buddhist']),
      en`hindu(?:s|ism|ists?)`(['I follow Hinduism']),
      en`sikh(?:s|ism)?`(['We are Sikh']),
      en`mormon\p{L}*`(['I am Mormon']),
      en`jehovah's witness\p{L}*`(['I\'m one of Jehovah\'s Witnesses']),
      en`atheis\p{L}*`(['I am an atheist']),
      en`${I_AM} (?:an? )?agnostic(?![-\s]+(?:about|to|of|in|towards?|regarding))`([
        'I am agnostic',
      ]),
      en`agnostic about (?:religion|god)`(['I am agnostic about religion']),
      en`orthodox (?:christian\p{L}*|jew\p{L}*)`(['She is an Orthodox Christian']),
      en`${I_AM} (?:very |deeply |quite )?religious`(['I am deeply religious']),
      en`religious (?:beliefs?|views?|affiliation|practices?|background|upbringing)`([
        'My religious beliefs shape my diet',
      ]),
      en`my religion`(['My religion forbids it']),
      en`baptized|baptised`(['I was baptized as a child']),
      en`(?:go|goes|went|going) to (?:the |a )?(?:church|mosque|synagogue)${NOT_STREET_EN}`([
        'I go to church every Sunday',
      ]),
      en`attend\p{L}* (?:the |a )?(?:church|mosque|synagogue)${NOT_STREET_EN}`([
        'I attend the mosque on Fridays',
      ]),
      en`sunday mass(?![-\s]+(?:transit|transport\p{L}*|shooting\p{L}*|market\p{L}*|media|hysteria|extinction|migration|surveillance|production|protest\p{L}*))`([
        'I never miss Sunday mass',
      ]),
      en`i (?:(?:do not|don't) )?believe in (?:god|allah|jesus)`([
        'I believe in God',
        'I don\'t believe in God',
      ]),
      en`(?:i|we) pray (?:daily|every|five|regularly|to (?:god|allah))`([
        'I pray every morning',
      ]),
      en`(?:daily|five daily) prayers?`(['I keep my daily prayers']),
      en`(?:(?:i|we) (?:observe|observed|celebrate|celebrated|keep|kept|am observing|are observing|am celebrating|are celebrating|fast during|fast for|am fasting for|are fasting for|will fast during|will celebrate|will observe)|(?:i|we) (?:am|are|'m|'re) (?:fasting|observing|celebrating)(?: during| for)?|my|our|fasting during|fast during) (?:the )?(?:\p{L}+ )?(?:ramadan|shabbat|yom kippur|hanukkah|eid al-?fitr|passover|lent)`([
        'I observe Shabbat every week',
        'I fast during Ramadan',
        'We celebrate Hanukkah at home',
      ]),
      en`keep(?:s|ing)? kosher`(['I keep kosher']),
      en`(?:eat|eats|only) halal`(['I only eat halal']),
      en`my (?:pastor|priest|imam|rabbi)`(['My pastor called me']),
      uk`християн\p{L}*`(['Я християнин']),
      uk`католик\p{L}*|католицьк\p{L}*`(['Я католик']),
      ukRu`протестант\p{L}*`(['Я протестант']),
      ukRu`мусульман\p{L}*`(['Я мусульманин']),
      uk`іслам(?![-\s]*абад)\p{L}*`(['Я прийняв іслам']),
      uk`іудей\p{L}*|іудаїзм\p{L}*|юдей\p{L}*`(['Я сповідую іудаїзм']),
      uk`я (?:є )?єврей\p{L}*`(['Я єврей', 'Я єврейка']),
      uk`буддист\p{L}*|буддизм\p{L}*|буддійськ\p{L}*`(['Я буддист']),
      uk`індуїз\p{L}*|індуїст\p{L}*`(['Я сповідую індуїзм']),
      uk`атеїст\p{L}*|атеїзм\p{L}*`(['Я атеїст']),
      uk`я (?:не )?вір(?:ю|имо) (?:в|у) (?:бога|аллаха|ісуса|христа)`([
        'Я не вірю в Бога',
        'Я вірю в Бога',
      ]),
      ukRu`агностик\p{L}*`(['Я агностик']),
      uk`віруюч\p{L}*`(['Я віруюча людина']),
      uk`релігійн\p{L}*`(['Я релігійна людина']),
      uk`мо(?:я|єї|ю) (?:релігі\p{L}*|віра|віри|віру)`(['Моя віра забороняє це']),
      uk`молитв\p{L}*`(['Щовечора читаю молитву']),
      uk`молю(?:сь|ся)`(['Я молюсь щодня']),
      uk`православ\p{L}*`(['Я православний']),
      uk`хрещен\p{L}*`(['Мене хрестили, я хрещена']),
      uk`(?:ходжу|ходимо|ходить|ходив|ходила) до (?:церкви|мечеті|синагоги|храму)`([
        'Я ходжу до церкви щонеділі',
      ]),
      uk`(?:дотримуюс\p{L}*|дотримуємос\p{L}*|тримаю|тримаємо|святкую|святкуємо|відзначаю|відзначаємо|постю|постимо|пощу\p{L}*) (?:\p{L}+ )?(?:рамадан|шабат|ханук|піст)\p{L}*`([
        'Я дотримуюсь рамадану',
        'Ми святкуємо хануку',
        'Я тримаю піст',
      ]),
      uk`свід(?:ок|к\p{L}*) єгов\p{L}*`(['Я свідок Єгови']),
      pl`chrześcijan\p{L}*`(['Jestem chrześcijaninem']),
      pl`katolik\p{L}*|katolick\p{L}*|katoliczk\p{L}*`(['Jestem katolikiem']),
      pl`protestant\p{L}*`(['Jestem protestantem']),
      pl`muzułman\p{L}*`(['Jestem muzułmaninem']),
      pl`islam(?![-\s]*abad)\p{L}*`(['Przeszedłem na islam']),
      pl`jestem (?:\p{L}+ )?(?:żyd|żydem|żydówką)|żydowsk\p{L}* (?:wiar|religi|rodzin|święt|gmin)\p{L}*`([
        'Jestem Żydem',
        'Moja żydowska rodzina obchodzi święta',
      ]),
      pl`buddy(?:st|zm|js)\p{L}*`(['Jestem buddystą']),
      pl`hindu(?:iz|is|s)\p{L}*`(['Wyznaję hinduizm']),
      pl`ateist\p{L}*|ateizm\p{L}*`(['Jestem ateistą']),
      pl`agnostyk\p{L}*`(['Jestem agnostykiem']),
      pl`(?:nie )?wierzę w (?:boga|allaha|jezusa|chrystusa)`([
        'Nie wierzę w Boga',
        'Wierzę w Boga',
      ]),
      pl`wierząc(?:y|a|ą|ym|ej)`(['Jestem osobą wierzącą']),
      pl`religijn\p{L}*`(['Jestem religijny']),
      pl`moj\p{L}* (?:wiar|religi)\p{L}*`(['Moja wiara jest ważna']),
      pl`modlitw\p{L}*`(['Codziennie odmawiam modlitwę']),
      pl`modlę się`(['Modlę się co wieczór']),
      pl`prawosławn\p{L}*`(['Jestem prawosławny']),
      pl`ochrzczon\p{L}*`(['Jestem ochrzczony']),
      pl`chodzę do (?:kościoła|meczetu|synagogi|cerkwi)`(['Chodzę do kościoła w niedzielę']),
      pl`(?:przestrzegam|obchodzę|obchodzimy|poszczę|szczymy|trzymam|pości\p{L}*|poszcz\p{L}*) (?:\p{L}+ )?(?:ramadan|szabat|chanuk|post)\p{L}*`([
        'Przestrzegam ramadanu',
        'Obchodzimy szabat',
      ]),
      pl`świad(?:ek|k\p{L}*) jehow\p{L}*`(['Jestem świadkiem Jehowy']),
      ru`христиан\p{L}*`(['Я христианин']),
      ru`католик\p{L}*|католическ\p{L}*`(['Я католик']),
      ru`ислам(?![-\s]*абад)\p{L}*`(['Я принял ислам']),
      ru`иудей\p{L}*|иудаизм\p{L}*`(['Я исповедую иудаизм']),
      ru`я (?:\p{L}+ )?еврей\p{L}*`(['Я еврей', 'Я наполовину еврейка']),
      ru`буддист\p{L}*|буддизм\p{L}*|буддийск\p{L}*`(['Он буддист']),
      ru`индуизм\p{L}*|индуист\p{L}*`(['Я исповедую индуизм']),
      ru`атеист\p{L}*|атеизм\p{L}*`(['Я атеист']),
      ru`я (?:не )?верю в (?:бога|аллаха|иисуса|христа)`([
        'Я не верю в Бога',
        'Я верю в Бога',
      ]),
      ru`верующ\p{L}*`(['Я верующий человек']),
      ru`религиозн\p{L}*`(['Я религиозный человек']),
      ru`мо(?:я|ей|ю) (?:религи\p{L}*|вера|веры|веру)`(['Моя вера запрещает это']),
      ru`молитв\p{L}*`(['Читаю молитву']),
      ru`молюсь|молимся`(['Я молюсь каждый день']),
      ru`православн\p{L}*`(['Я православный']),
      ru`крещен\p{L}*|крестил\p{L}*`(['Я крещёный']),
      ru`хожу в (?:церковь|мечеть|синагогу|храм)`(['Я хожу в церковь']),
      ru`(?:соблюда\p{L}*|держ\p{L}*|праздну\p{L}*|отмеча\p{L}*|пощусь|постимся) (?:\p{L}+ )?(?:рамадан|шаббат|ханук|пост)\p{L}*`([
        'Я соблюдаю рамадан',
        'Мы празднуем хануку',
        'Я держу пост',
      ]),
      ru`свидетел\p{L}* иегов\p{L}*`(['Я свидетель Иеговы']),
    ],
  },
  {
    category: 'political-opinion',
    patterns: [
      en`political (?:party|views?|opinions?|beliefs?|affiliation|leanings?|orientation)`([
        'My political views are quite left-wing',
      ]),
      en`(?:${I_AM}|we are) (?:an? )?(?:registered )?(?:republican|democrat|conservative|liberal|socialist|communist|libertarian|marxist|nationalist|fascist|anarchist)s?${IDEOLOGY_END_EN}`([
        'I am a registered Republican.',
        'I\'m a conservative in politics',
        'We are socialists',
      ]),
      en`(?:(?:i|we) (?:voted|vote|will vote|plan to vote|would vote)|${I_AM} voting|we(?:'re| are) voting) for (?:the |a |an |my )?(?:\p{L}+ ){0,2}(?:${POLITICAL_NOUNS_EN})`([
        'I voted for the Labour candidate',
        'I vote for the Green party',
        'I am voting for a new president',
      ]),
      en`(?:member of|belong to|belongs to|joined|supporter of|support|supports|voting for) (?:the |a )?(?:labou?r|conservative|democratic|republican|green|socialist|communist|liberal|nationalist|libertarian|social democratic|tory|political|far[-\s]right|far[-\s]left) party`([
        'I am a member of the Green Party',
      ]),
      en`${I_AM} (?:an? |very )?(?:left|right)[-\s]wing`(['I am right-wing']),
      en`(?:left|right)[-\s]wing (?:views?|politics|voter|supporter|beliefs?|party)`([
        'I hold left-wing views',
      ]),
      en`${I_AM} pro[-\s](?:life|choice)`(['I am pro-choice']),
      uk`політичн\p{L}* (?:погляд|переконан|парті|уподобан|орієнтац)\p{L}*`([
        'Мої політичні погляди ліберальні',
        'Моя політична партія',
        'Я підтримую політичну партію',
      ]),
      uk`(?:про)?голосу(?:ю|ємо|є|ють|ва\p{L}*) за (?:\p{L}+ ){0,2}(?:парті\p{L}*|кандидат\p{L}*|виборах|виборів|вибори|президент\p{L}*|парламент\p{L}*|референдум\p{L}*)`([
        'Я голосував за цю партію на виборах',
        'Я голосую за кандидата від опозиції',
        'Буду голосувати за президента',
      ]),
      uk`член\p{L}* партії|належ\p{L}* до партії`(['Я член партії']),
      uk`(?:лівих|правих) (?:поглядів|переконань)`(['Я людина правих поглядів']),
      uk`(?:ліво|право)радикал\p{L}*`(['Я праворадикал']),
      uk`я (?:консерватор|лібертаріан|соціаліст|комуніст|націоналіст|монархіст|анархіст|ліберал)\p{L}*${IDEOLOGY_END_UK}`([
        'Я консерватор.',
        'Я ліберал у політиці',
        'Я націоналіст і мій дід теж',
      ]),
      uk`підтримую партію`(['Я підтримую партію']),
      pl`pogląd\p{L}* polityczn\p{L}*`(['Moje poglądy polityczne są konserwatywne']),
      pl`preferencj\p{L}* polityczn\p{L}*`(['Moje preferencje polityczne są prywatne']),
      pl`polityczn\p{L}* parti\p{L}*|parti\p{L}* polityczn\p{L}*`([
        'Moja partia polityczna',
      ]),
      pl`(?:głosu(?:ję|jemy)|głosowa\p{L}*) na (?:\p{L}+ ){0,2}(?:partię|partii|kandydat\p{L}*|wybor(?:ach|ów|y)|prezydent\p{L}*|parlament\p{L}*|referendum|sejm\p{L}*)`([
        'Głosowałem na tę partię',
        'Będę głosować na kandydata opozycji',
        'Głosuję na prezydenta',
      ]),
      pl`członk\p{L}* partii|należ\p{L}* do partii`(['Jestem członkiem partii od lat']),
      pl`(?:lewicow|prawicow)\p{L}* (?:pogląd|przekonan|orientacj)\p{L}*`([
        'Mam lewicowe poglądy',
      ]),
      pl`jestem (?:lewicowcem|prawicowcem|konserwatyst\p{L}*|liberał\p{L}*|socjalist\p{L}*|komunist\p{L}*|nacjonalist\p{L}*|libertarian\p{L}*)${IDEOLOGY_END_PL}`([
        'Jestem konserwatystą.',
        'Jestem liberałem w polityce',
      ]),
      pl`popieram partię`(['Popieram partię od lat']),
      ru`политическ\p{L}* (?:взгляд|убежден|предпочтен|позици|парти|ориентац)\p{L}*`([
        'Мои политические взгляды консервативные',
        'Моя политическая партия',
      ]),
      ru`(?:(?:про)?голосу(?:ю|ем|ет|ют)|(?:про)?голосова\p{L}*) за (?:\p{L}+ ){0,2}(?:парти\p{L}*|кандидат\p{L}*|выборах|выборов|выборы|президент\p{L}*|парламент\p{L}*|референдум\p{L}*)`([
        'Я голосовал за эту партию',
        'Буду голосовать за кандидата',
        'Мы голосуем за президента',
      ]),
      ru`член\p{L}* партии|состою в партии`(['Я состою в партии']),
      ru`(?:левых|правых) (?:взглядов|убеждений)`(['Я человек левых взглядов']),
      ru`я (?:консерватор|либерал|социалист|коммунист|националист|монархист|либертариан|анархист)\p{L}*${IDEOLOGY_END_RU}`([
        'Я консерватор.',
        'Я либерал в политике',
      ]),
      ru`поддерживаю партию`(['Я поддерживаю партию']),
    ],
  }, {
    category: 'racial-or-ethnic-origin',
    patterns: [
      en`ethnic origin|ethnicity|ethnicities`(['My ethnic origin is Roma']),
      en`ethnic (?:minorit\p{L}*|group|background|identity)`([
        'I belong to an ethnic minority',
      ]),
      en`racial (?:origin|background|identity|group)`(['My racial background is mixed']),
      en`(?:african|asian|hispanic|latino|arab|native american|mexican|irish|italian|polish|chinese|korean|indian) (?:descent|heritage|ancestry)`([
        'I am of Korean descent',
      ]),
      en`african[-\s]american|afro[-\s](?:american|caribbean|latino|brazilian)`([
        'I am African-American',
      ]),
      en`${I_AM} (?:an? )?(?:black|white|asian|hispanic|latino|latina|arab) (?:man|woman|person|guy|girl|male|female)`([
        'I am a black woman',
      ]),
      en`(?:people|person) of colou?r`(['As a person of color I notice this']),
      en`(?:romani|romany) (?:descent|heritage|ancestry|origin|people|community|family)|roma people`([
        'My Romani family moved north',
        'Roma people in my village',
      ]),
      en`${I_AM} (?:an? )?(?:romani|romany|roma|gypsy)${CLAUSE_END_EN}`(['I am Romani.']),
      uk`етнічн\p{L}* (?:походж|приналежн|меншин|груп|ідентичн)\p{L}*`([
        'Моя етнічна приналежність — ромська',
      ]),
      uk`за національністю|за походженням я`(['За національністю я ромка']),
      uk`расов\p{L}* (?:походж|приналежн|ідентичн)\p{L}*`(['Моє расове походження змішане']),
      uk`ромськ\p{L}* (?:національн|походж|громад)\p{L}*`(['Я з ромської громади']),
      ukRu`афроамерикан\p{L}*`(['Я афроамериканець']),
      uk`чорношкір\p{L}*|темношкір\p{L}*`(['Він чорношкірий']),
      pl`pochodzeni\p{L}* etniczn\p{L}*`(['Moje pochodzenie etniczne jest romskie']),
      pl`etniczn\p{L}* (?:pochodz|przynależn|mniejszoś|grup)\p{L}*`([
        'Pochodzę z etnicznej mniejszości',
      ]),
      pl`(?:mniejszoś|grup)\p{L}* etniczn\p{L}*`(['Należę do mniejszości etnicznej']),
      pl`narodowości romskiej|jestem narodowości \p{L}+`(['Jestem narodowości romskiej']),
      pl`(?:romskiego|żydowskiego|afrykańskiego|azjatyckiego) pochodzenia`(['Jestem żydowskiego pochodzenia']),
      pl`pochodzeni\p{L}* (?:romsk|żydowsk|afrykańsk|azjatyck|rasow)\p{L}*`([
        'Mam pochodzenie żydowskie',
      ]),
      pl`rasow\p{L}* (?:pochodz|przynależn|tożsam)\p{L}*`(['Moja rasowa tożsamość jest mieszana']),
      pl`czarnoskór\p{L}*|ciemnoskór\p{L}*`(['Jest czarnoskóry']),
      pl`afroamerykan\p{L}*`(['Jestem Afroamerykaninem']),
      ru`этническ\p{L}* (?:происхожден|принадлежн|меньшинств|групп|идентичн)\p{L}*`([
        'Моя этническая принадлежность — цыгане',
      ]),
      ru`по национальности`(['По национальности я цыганка']),
      ru`расов\p{L}* (?:происхожден|принадлежн|идентичн)\p{L}*`(['Моё расовое происхождение смешанное']),
      ru`цыганск\p{L}* (?:национальн|происхожден)\p{L}*`(['Я цыганской национальности']),
      ru`чернокож\p{L}*|темнокож\p{L}*`(['Он чернокожий']),
    ],
  },
  {
    category: 'sex-life-or-orientation',
    patterns: [
      en`gay(?![-\s]+(?:lussac|${STREET_WORDS_EN})${WORD_END})`(['I am gay']),
      en`lesbians?|bisexual\p{L}*|homosexual\p{L}*|asexual\p{L}*|pansexual\p{L}*`([
        'My sister is a lesbian',
        'I am bisexual',
      ]),
      en`transgender|trans (?:man|woman|person|people|girl|guy)`(['She is transgender']),
      en`${I_AM} non[-\s]?binary|non[-\s]?binary (?:person|people|gender|identity)`([
        'I am non-binary',
      ]),
      en`${I_AM} (?:part of )?(?:the )?lgbt\p{L}*|lgbt\p{L}* community`([
        'I am part of the LGBTQ community',
      ]),
      en`sexual orientation|gender identity`(['My sexual orientation is private']),
      en`(?:coming out|came out|come out) (?:as|to (?:my|his|her|our) (?:parents|family|friends))`([
        'I am coming out as gay',
        'She came out to my family',
      ]),
      en`(?:coming|came) out of the closet`(['I came out of the closet at twenty']),
      en`sex life|sexual (?:preferences?|partners?|practices|dysfunction)`([
        'My sex life is private',
      ]),
      en`erectile dysfunction|libido`(['I have low libido']),
      any`bdsm`(['I am into BDSM']),
      en`kinky|fetish\p{L}*`(['I have a foot fetish']),
      en`polyamor\p{L}*`(['We are polyamorous']),
      en`(?:${I_AM} in|we(?:'re| are) in|are in|were in|have|had|having|our|my) (?:an? )?open relationship`([
        'We are in an open relationship',
        'I have an open relationship with my husband',
      ]),
      uk`(?:я|ми|він|вона|мій|моя) (?:є )?гей`(['Я гей, і мій партнер теж']),
      uk`геї|геїв|геєм|гей-пар\p{L}*`(['Ми з партнером гей-пара']),
      uk`лесбі\p{L}*|бісексуал\p{L}*|гомосексуал\p{L}*`(['Вона лесбійка']),
      uk`трансгендер\p{L}*|транс(?:жінк|чолов)\p{L}*|небінарн\p{L}*`(['Вона трансгендерна жінка']),
      uk`сексуальн\p{L}* орієнтац\p{L}*`(['Моя сексуальна орієнтація — приватна справа']),
      uk`камінг-?аут\p{L}*`(['Я зробив камінг-аут']),
      uk`гендерн\p{L}* ідентичн\p{L}*`(['Моя гендерна ідентичність небінарна']),
      uk`сексуальн\p{L}* (?:життя|партнер|уподобан|практик)\p{L}*`(['Моє сексуальне життя приватне']),
      uk`інтимн\p{L}* життя`(['Моє інтимне життя нікого не стосується']),
      ukRu`бдсм`(['Я цікавлюсь БДСМ']),
      uk`еректильн\p{L}*|лібідо|фетиш\p{L}*|поліамор\p{L}*`(['У мене знижене лібідо']),
      pl`gej(?:a|em|owi|u|ów|ami|ach|e)?${NOT_STREET_PL}`(['Jestem gejem i mam męża']),
      pl`lesbij\p{L}*|biseksual\p{L}*|homoseksual\p{L}*`(['Jestem lesbijką']),
      pl`transpłciow\p{L}*|transseksual\p{L}*|niebinarn\p{L}*`(['Jestem osobą transpłciową']),
      pl`orientacj\p{L}* seksualn\p{L}*`(['Moja orientacja seksualna to prywatna sprawa']),
      pl`coming[-\s]out`(['Zrobiłem coming-out w rodzinie']),
      pl`tożsamoś\p{L}* płciow\p{L}*`(['Moja tożsamość płciowa jest niebinarna']),
      pl`życi\p{L}* seksualn\p{L}*|partner\p{L}* seksualn\p{L}*|preferencj\p{L}* seksualn\p{L}*`([
        'Moje życie seksualne jest prywatne',
      ]),
      pl`zaburzeni\p{L}* erekcji|libido|fetysz\p{L}*|poliamor\p{L}*`(['Mam zaburzenia erekcji']),
      ru`(?:я|мы|он|она|мой|моя|мои|как|стал|является|быть) гей(?:ем|я)?`(['Я гей и живу с партнёром']),
      ru`геи|геев|геям|геями|гей-(?:пар|сообществ|парад)\p{L}*`(['Мы с партнером гей-пара']),
      ru`лесби\p{L}*|бисексуал\p{L}*|гомосексуал\p{L}*`(['Она лесбиянка']),
      ru`трансгендер\p{L}*|транс(?:жен|мужч)\p{L}*|небинарн\p{L}*`(['Она трансгендерная женщина']),
      ru`сексуальн\p{L}* ориентац\p{L}*`(['Моя сексуальная ориентация не секрет']),
      ru`каминг-?аут\p{L}*`(['Я сделал каминг-аут']),
      ru`гендерн\p{L}* идентичн\p{L}*`(['Моя гендерная идентичность небинарная']),
      ru`сексуальн\p{L}* (?:жизн|партнер|предпочтен|практик)\p{L}*`(['Моя сексуальная жизнь приватна']),
      ru`интимн\p{L}* жизн\p{L}*`(['Моя интимная жизнь никого не касается']),
      ru`эректильн\p{L}*|либидо|фетиш\p{L}*|полиамор\p{L}*`(['У меня низкое либидо']),
    ],
  },
  {
    category: 'trade-union',
    patterns: [
      en`trade[-\s]unions?|labou?r unions?`(['I am a member of a trade union']),
      en`union (?:member|members|membership|dues|rep|representative|steward|organi[sz]er)`([
        'Our union dues went up again',
      ]),
      en`unioni[sz]ed|shop steward|collective bargaining`(['I am a shop steward']),
      en`(?:teachers?|workers?|nurses?|miners?|drivers?|farmers?|dockers?|pilots?|journalists?)'?s?'? union`([
        'I joined the teachers\' union',
      ]),
      en`afl-cio|teamsters`(['I belong to the Teamsters']),
      uk`профспілк\p{L}*|профспілков\p{L}*|профком\p{L}*`(['Я голова профспілки на заводі']),
      pl`związk\p{L}* zawodow\p{L}*`(['Należę do związku zawodowego nauczycieli']),
      pl`związkow(?:iec|c\p{L}*)`(['Pisze do mnie związkowiec z zakładu']),
      pl`nszz|opzz`(['Jestem w OPZZ']),
      pl`(?:(?:jestem|byłem|byłam|działam|należę|zapisałem się|zapisałam się) (?:członkiem |członkinią )?(?:w|do) |(?:członkiem|członkinią) )(?:nszz )?solidarno(?:ści|ść)`([
        'Jestem w Solidarności',
        'Należę do Solidarności',
      ]),
      ru`профсоюз\p{L}*|профком\p{L}*`(['Я состою в профсоюзе уже давно']),
    ],
  },
  {
    category: 'genetic',
    patterns: [
      en`dna[-\s]test(?:s|ing)?`(['I did a DNA test', 'DNA testing kit arrived']),
      en`(?:my|his|her|their|our|your) (?:\p{L}+ )?dna[-\s](?:results?|analysis|profile|sample)`([
        'My DNA results arrived',
      ]),
      en`genetic (?:test(?:ing)?|condition|disorder|disease|mutation|predisposition|screening|marker|history|counsell?ing)`([
        'My genetic condition runs in the family',
      ]),
      any`brca\d?`(['I carry BRCA1']),
      en`23andme|ancestry dna`(['I used 23andMe']),
      en`hereditary (?:disease|condition|disorder)`(['It is a hereditary condition']),
      en`gene mutation`(['I have a gene mutation']),
      en`down(?:'s)? syndrome|cystic fibrosis|sickle[-\s]cell|huntington'?s? disease`([
        'My cousin has Down syndrome',
      ]),
      uk`генетичн\p{L}* (?:тест|аналіз|захворюван|мутац|схильн|розлад|дослідж)\p{L}*`([
        'У родині є генетичне захворювання',
      ]),
      uk`(?:тест\p{L}*|аналіз\p{L}*|результат\p{L}*) днк|днк[-\s]тест\p{L}*`([
        'Зробив тест ДНК',
        'Прийшли результати ДНК',
      ]),
      uk`синдром дауна|муковісцидоз\p{L}*|серпоподібноклітинн\p{L}*`(['У сина синдром Дауна']),
      pl`genetyczn\p{L}* (?:badan|test|choro|wad|mutac|predyspozyc|obciążen)\p{L}*`([
        'Mam genetyczne predyspozycje do cukrzycy',
      ]),
      pl`(?:test\p{L}*|badani\p{L}*) (?:dna|genetyczn\p{L}*)`([
        'Zrobiłem test DNA',
        'Zrobiłem badanie genetyczne',
      ]),
      pl`zespół downa|mukowiscydoz\p{L}*|anemi\p{L}* sierpowat\p{L}*`(['Mamy w rodzinie zespół Downa']),
      ru`генетическ\p{L}* (?:тест|анализ|заболеван|мутаци|предрасположен|расстройств|исследован)\p{L}*`([
        'Сделал генетический анализ',
      ]),
      ru`(?:тест\p{L}*|анализ\p{L}*|результат\p{L}*) днк|днк[-\s]тест\p{L}*`([
        'Сделал тест ДНК',
        'Пришли результаты ДНК',
      ]),
      ru`синдром дауна|муковисцидоз\p{L}*|серповидноклеточн\p{L}*`(['У сына синдром Дауна']),
    ],
  },
  {
    category: 'biometric',
    patterns: [
      en`biometric (?:data|templates?|identifiers?|identification|information|profiles?|scans?|records?)`([
        'The app stores my biometric data',
      ]),
      en`fingerprint (?:data|templates?|records?|databases?|images?)`([
        'They keep a fingerprint database of employees',
      ]),
      en`fingerprints? (?:(?:were|was|are|is|got|being) )?(?:taken|stored|collected)|fingerprints? on file`(['My fingerprints were taken at the border']),
      en`my (?:fingerprints?|face scan|retina scan|iris scan|voiceprint)`([
        'They scanned my fingerprints',
      ]),
      en`(?:retina|iris) scans?|voice ?print|palm vein`(['The door uses an iris scan']),
      en`facial (?:geometry|templates?|recognition (?:data|templates?|profiles?))`([
        'They store my facial geometry',
      ]),
      uk`біометричн\p{L}* (?:дан|ідентифік|шаблон|інформац|відбит|профіл)\p{L}*`([
        'Система зберігає мої біометричні дані',
      ]),
      uk`дан\p{L}* біометричн\p{L}*`(['Дані біометричні збираються на вході']),
      uk`(?:мої|мій|взяли|база) відбитк\p{L}* пальц\p{L}*`(['У мене взяли відбитки пальців']),
      uk`скан\p{L}* (?:сітківки|райдужки|обличчя|долоні)`(['Вони роблять скан обличчя']),
      uk`голосов\p{L}* відбит(?:ок|к\p{L}*)`(['Банк зберігає голосовий відбиток']),
      pl`biometry\p{L}* (?:dan|identyfik|wzor|szablon)\p{L}*`([
        'Biometryczne dane pracowników są szyfrowane',
      ]),
      pl`dan\p{L}* biometryczn\p{L}*`([
        'Dane biometryczne są szyfrowane',
        'Firma zbiera moje dane biometryczne',
      ]),
      pl`(?:moje|mój|pobrano|pobrali|zapisan\p{L}*|baza) odcisk\p{L}* palc\p{L}*`([
        'Pobrano moje odciski palców',
      ]),
      pl`skan\p{L}* (?:siatkówki|tęczówki|twarzy)`(['Robią skan twarzy przy wejściu']),
      pl`odcisk\p{L}* głosu`(['Bank zapisuje odcisk głosu']),
      ru`биометрическ\p{L}* (?:данн|идентификатор|шаблон|информац|профил)\p{L}*`([
        'Приложение хранит мои биометрические данные',
      ]),
      ru`данн\p{L}* биометрическ\p{L}*`(['Данные биометрические собираются на входе']),
      ru`(?:мои|мой|взяли|база) отпечатк\p{L}* пальц\p{L}*`(['У меня взяли отпечатки пальцев']),
      ru`скан\p{L}* (?:сетчатки|радужки|лица|ладони)`(['Они делают скан лица']),
      ru`голосов\p{L}* отпечат\p{L}*`(['Банк хранит голосовой отпечаток']),
    ],
  },
  {
    category: 'legal-dispute',
    patterns: [
      en`lawsuits?`(['The lawsuit starts next month']),
      en`(?:i|we|they|he|she|been|being|got|get|was|am|is) sued|sue (?:my|the|him|her|them|over)|suing`([
        'I am being sued by my landlord',
      ]),
      en`court (?:case|hearing|date|order|ruling|summons)`(['My court date is Monday']),
      en`custody (?:battle|dispute|case|hearing)`(['The custody battle starts next month']),
      en`divorce (?:proceedings?|case|papers|hearing|lawyer|settlement)`([
        'The divorce proceedings are stressful',
      ]),
      en`getting (?:a )?divorce(?:d)?|going through (?:a )?divorce|(?:filed|filing|file) for (?:a )?divorce`([
        'I\'m getting divorced',
        'We are going through a divorce',
        'She filed for divorce',
      ]),
      en`legal (?:dispute|battle|proceedings?|action)`(['We are in a legal dispute']),
      en`small claims|subpoena|restraining order`(['I got a restraining order']),
      en`(?:charged with|convicted of) (?:an? )?(?:${CRIME_WORDS_EN})`([
        'He was charged with fraud',
        'Convicted of drunk driving in 2012',
      ]),
      en`criminal case`(['There is a criminal case against me']),
      uk`судов\p{L}* (?:справ|розгляд|позов|процес|засідан|спір)\p{L}*`([
        'Мені потрібна судова справа про спадок',
      ]),
      uk`позов\p{L}*`(['Подали позов проти орендодавця']),
      uk`су(?:джуся|димося|дяться|диться|дилися|дилася|дився)`(['Я суджуся з орендодавцем']),
      uk`розлучаю(?:ся|сь)|розлучаємо(?:ся|сь)|розлучається`(['Я розлучаюся']),
      uk`(?:подав|подал\p{L}*|подаю|подаємо) (?:заяву )?на розлучення|розлучен\p{L}* (?:справ|процес)\p{L}*|процес\p{L}* розлучення|мо(?:є|го|єму|їм) розлучен\p{L}*`([
        'Я подав на розлучення',
        'Моє розлучення було важким',
      ]),
      uk`кримінальн\p{L}* (?:справ|провадж)\p{L}*`(['Проти мене відкрили кримінальну справу']),
      uk`мій адвокат|повістк\p{L}* до суду`(['Мій адвокат подав апеляцію']),
      pl`pozew|pozw(?:u|em|y|ów|ali|ał|ała|ano|ę)`(['Złożyłem pozew przeciwko sąsiadowi']),
      pl`spraw\p{L}* (?:sądow|karn|rozwodow|cywiln|spadkow|o (?:rozwód|alimenty|opiekę))\p{L}*`([
        'Mam sprawę rozwodową w sądzie',
      ]),
      pl`rozpraw\p{L}* (?:sądow|karn|rozwodow|cywiln)\p{L}*`(['Rozprawa sądowa jest w piątek']),
      pl`(?:mam|moja) rozpraw(?:ę|a|y)(?![-\s]+(?:doktors|naukow|habilit))`(['Mam rozprawę w sądzie']),
      pl`postępowani\p{L}* (?:sądow|karn|rozwodow|spadkow)\p{L}*`(['Toczy się postępowanie karne']),
      pl`sąd(?:zie|u|y)? (?:rodzinn|karn|cywiln|okręgow|rejonow)\p{L}*`(['Sprawa jest w sądzie rodzinnym']),
      pl`(?:mój|moj\p{L}*) (?:adwokat|prawnik|mecenas)\p{L}*`(['Mój adwokat złożył apelację']),
      pl`sądz(?:ę|imy|ymy|i|ą) się z`(['Sądzę się z sąsiadem']),
      pl`rozwodz(?:ę|imy|i|ą) się(?!\s+nad)`(['Rozwodzę się']),
      pl`(?:biorę|bierzemy|składam|złożyłem|złożyłam|złożyliśmy|mam|mamy) rozwód|(?:mój|moj\p{L}*) rozw(?:ód|od\p{L}*)`([
        'Biorę rozwód',
        'Mój rozwód jest w toku',
      ]),
      ru`судебн\p{L}* (?:дел|разбирательств|иск|процесс|заседани|спор)\p{L}*`(['У меня судебное дело о разводе']),
      ru`иск(?:а|у|ом|е|и|ов)?|исков\p{L}* заявлен\p{L}*`(['Подал иск против арендодателя']),
      ru`подал\p{L}* в суд`(['Я подал в суд на соседа']),
      ru`су(?:жусь|димся|дятся|дится|дились|дилась|дился)`(['Я сужусь с арендодателем']),
      ru`развож(?:усь|ается)|разводимся`(['Я развожусь', 'Мы разводимся']),
      ru`подал\p{L}* на развод\p{L}*|процесс\p{L}* развода|мо(?:й|его|ему|им) развод\p{L}*`([
        'Я подала на развод',
        'Мой развод оформляют',
      ]),
      ru`бракоразводн\p{L}* (?:процесс|дел)\p{L}*|дел\p{L}* о разводе`([
        'Идёт бракоразводный процесс',
      ]),
      ru`уголовн\p{L}* дел\p{L}*`(['Против меня возбудили уголовное дело']),
      ru`мо(?:й|его|я|ей) (?:адвокат|юрист)\p{L}*`(['Мой адвокат подал жалобу']),
      ru`повестк\p{L}* в суд`(['Мне пришла повестка в суд']),
    ],
  },
  {
    category: 'drugs',
    patterns: [
      any`mdma`(['I took MDMA once']),
      en`cocaine|heroin|marijuana|fentanyl|ketamine|narcotics?`(['I used cocaine in college']),
      en`cannabis (?:use|user|addiction|smoker|oil)`(['I am a cannabis smoker']),
      en`smok\p{L}* (?:weed|pot)`(['I smoke weed on weekends']),
      en`methamphetamine|crystal meth|meth (?:addict|use)`(['He used crystal meth']),
      en`amphetamine\p{L}*`(['I took amphetamines']),
      en`opioid (?:addiction|use|dependence)`(['She has an opioid addiction']),
      en`drug (?:addiction|addicts?|abuse|dependence|rehab)`(['He struggles with drug addiction']),
      en`(?:my|his|her|their|past|previous|recreational) drug use`(['My drug use got worse']),
      en`(?:i|he|she|we|they) (?:use|used|do|did) (?:illegal |recreational |hard )?drugs(?![.-]\p{L})`([
        'I used drugs in my twenties',
      ]),
      en`recreational drugs?|substance (?:abuse|use disorder)`(['I stopped recreational drugs']),
      en`alcoholism|alcohol (?:addiction|abuse|dependence)|recovering alcoholic`([
        'My father struggled with alcoholism',
      ]),
      en`${I_AM} an alcoholic`(['I am an alcoholic']),
      en`psilocybin|magic mushrooms|hallucinogens?`(['I tried magic mushrooms']),
      ukRu`мдма`(['Він пробував МДМА']),
      uk`кокаїн\p{L}*|героїн\p{L}*|марихуан\p{L}*|канабіс\p{L}*`(['Колись він вживав кокаїн']),
      uk`амфетамін\p{L}*|метамфетамін\p{L}*|фентаніл\p{L}*`(['Він вживав амфетамін']),
      uk`наркотик\p{L}*|наркоман\p{L}*|наркозалежн\p{L}*`(['Бореться з наркоманією']),
      uk`алкоголізм\p{L}*|алкозалежн\p{L}*|алкоголік\p{L}*`(['Лікуюсь від алкоголізму']),
      uk`кур(?:ю|имо|ив|ила|ить|ять|я\p{L}*) (?:траву|марихуан\p{L}*)`(['Я курю траву по вихідних']),
      pl`kokain\p{L}*|heroin(?:a|y|\u0119|ie|ą)|marihuan\p{L}*`(['Kiedyś brał kokainę']),
      pl`amfetamin\p{L}*|metamfetamin\p{L}*|fentanyl\p{L}*`(['Brał amfetaminę']),
      pl`narkotyk\p{L}*|narkoman\p{L}*|dopalacz\p{L}*`(['Walczy z narkomanią']),
      pl`pal(?:ę|imy|i|ą) (?:trawk\p{L}*|zioło|marihuan\p{L}*|skręt\p{L}*)`(['Palę trawkę w weekendy']),
      pl`uzależni(?:en|on)\p{L}* od (?:narkotyk|alkohol|leków|heroin|kokain)\p{L}*`([
        'Jestem uzależniony od alkoholu',
      ]),
      pl`alkoholizm\p{L}*|alkoholik\p{L}*`(['Leczę alkoholizm']),
      ru`кокаин\p{L}*|героин\p{L}*|марихуан\p{L}*|каннабис\p{L}*`(['Раньше употреблял героин']),
      ru`амфетамин\p{L}*|метамфетамин\p{L}*|фентанил\p{L}*`(['Он употреблял амфетамин']),
      ru`наркотик\p{L}*|наркоман\p{L}*|наркозависим\p{L}*`(['Лечится от наркомании']),
      ru`алкоголизм\p{L}*|алкоголик\p{L}*|алкозависим\p{L}*`(['Лечусь от алкоголизма']),
      ru`кур\p{L}* (?:травк|марихуан|косяк)\p{L}*`(['Я курю травку по выходным']),
    ],
  },
]
