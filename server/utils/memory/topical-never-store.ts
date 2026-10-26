import type { NeverStoreKind } from '#shared/types/memory.d'
import {
  compileSensitiveTextExpression,
  normalizeSensitiveText,
  normalizeSensitiveTextCase,
} from '~~/server/utils/memory/sensitivity'
import { foldPolishDiacritics } from '~~/server/utils/memory/text-folding'

type TopicalNeverStoreKind = Extract<
  NeverStoreKind,
  'home-address' | 'immigration-status' | 'criminal-history'
>

interface TopicalNeverStoreRule {
  kind: TopicalNeverStoreKind
  sources: readonly string[]
  casedSources?: readonly string[]
}

const HOUSE_NUMBER = String.raw`\d{1,5}[a-z]?`
const NAME_WORDS = String.raw`(?:\p{L}[\p{L}'.-]* ){1,3}`
const NAME_WORDS_WITH_COMMA = String.raw`(?:\p{L}[\p{L}'.-]*,? ){1,3}`
const SHORT_GAP = String.raw`[^\n\d]{0,30}`

const ADDRESS_SEPARATOR = String.raw`(?: is| -| —|:)\s*`
const STREET_ABBREVIATIONS_PL = 'ul'
const STREET_ABBREVIATIONS_UK = 'вул|просп|пров|бульв|пл'

const ADDRESS_QUALIFIERS_EN = 'home |postal |mailing |residential |street '

const CASED_HOUSE_NUMBER = String.raw`\d{1,5}[A-Za-z]?,?`
const CAPITALISED_NAME_WORDS = String.raw`(?:[A-Z][\p{L}'.-]*,? ){1,3}`
const STREET_WORDS_CASED = [
  '[Ss]treet',
  'St\\.?',
  '[Rr]oad',
  'Rd\\.?',
  '[Aa]venue',
  'Ave\\.?',
  '[Ll]ane',
  'Ln\\.?',
  '[Bb]oulevard',
  'Blvd\\.?',
  'Drive',
  'Dr\\.?',
  'Way',
  'Close',
  'Court',
  'Place',
  'Terrace',
  'Crescent',
  'Square',
].join('|')

const SUBJECT_EN = String.raw`(?:(?:i|we|he|she|they) )?`
const STATUS_VERBS_EN = [
  'have',
  'has',
  'had',
  'got',
  'hold',
  'holds',
  'received',
  'obtained',
  'renewed',
  'lost',
  'applied for',
  'am applying for',
  'is applying for',
  'are applying for',
  'was granted',
  'were granted',
  'was denied',
  'am waiting for',
  'is waiting for',
  'am under',
  'is under',
  'are under',
].join('|')
const ARTICLE_OR_POSSESSIVE_EN = String.raw`(?:(?:a|an|the|my|his|her|their|our) )?`
const POSSESSIVE_EN = 'my|his|her|their|our'
const IMMIGRATION_STATUS_TERMS_EN = [
  'green card',
  '(?:residence|residency|resident|work) permit',
  'temporary protection',
  'refugee status',
  'humanitarian visa',
].join('|')

const STATUS_VERBS_PL = String.raw`mam|ma|mamy|maja|dostal\p{L}*|otrzymal\p{L}*|uzyskal\p{L}*|czekam na|czeka na|objet\p{L}*`
const POSSESSIVE_PL = String.raw`moj\p{L}*|jego|jej`
const STATUS_VERBS_UK = String.raw`маю|має|мають|мала|мав|отрима\p{L}*|оформи\p{L}*|чекаю на|чекає на`
const POSSESSIVE_UK = String.raw`мій|моя|мою|моєї|його|її`

/**
 * Deterministic, deliberately narrow shapes for the topical never-store
 * kinds that used to rely on the extractor label alone. `sources` are written
 * lowercase and without Polish diacritics and are matched against the folded
 * text; `casedSources` keep capital letters and are matched against the
 * case-preserving view. Each shape needs a strong signal: a house number next
 * to a capitalised street name, an address cue next to a number, or a status
 * term stated about a person ("my work permit expires", "I have temporary
 * protection"), so an address book app, a work permit template or a book
 * about criminal records are not caught.
 */
const topicalNeverStoreRules: readonly TopicalNeverStoreRule[] = [
  {
    kind: 'home-address',
    sources: [
      String.raw`(?:live|lives|living|reside|resides|residing) at (?:number |no\.? )?${HOUSE_NUMBER}`,
      String.raw`(?:my|our|his|her|their) (?:${ADDRESS_QUALIFIERS_EN})?address${ADDRESS_SEPARATOR}${SHORT_GAP}\d`,
      String.raw`(?:${STREET_ABBREVIATIONS_PL})\.\s*${NAME_WORDS}${HOUSE_NUMBER}`,
      String.raw`(?:mieszkam|mieszka|mieszkamy|mieszkaja) pod adresem`,
      String.raw`(?:moj|nasz) adres(?: zamieszkania)?(?: to| -| —|:)\s*${SHORT_GAP}\d`,
      String.raw`adres zamieszkania(?: to| -| —|:)\s*${SHORT_GAP}\d`,
      String.raw`(?:${STREET_ABBREVIATIONS_UK})\.\s*${NAME_WORDS_WITH_COMMA}${HOUSE_NUMBER}`,
      String.raw`(?:живу|живемо|проживаю|мешкаю) за адресою`,
      String.raw`(?:моя|наша) (?:домашня |поштова )?адреса(?: —| -|:)\s*${SHORT_GAP}\d`,
    ],
    casedSources: [
      String.raw`${CASED_HOUSE_NUMBER} ${CAPITALISED_NAME_WORDS}(?:${STREET_WORDS_CASED})`,
      String.raw`[Mm]ieszka(?:m|my|ja)? przy (?:ul\.\s*)?${CAPITALISED_NAME_WORDS}${CASED_HOUSE_NUMBER}`,
    ],
  },
  {
    kind: 'immigration-status',
    sources: [
      String.raw`${SUBJECT_EN}(?:${STATUS_VERBS_EN}) ${ARTICLE_OR_POSSESSIVE_EN}(?:${IMMIGRATION_STATUS_TERMS_EN})s?`,
      String.raw`(?:${POSSESSIVE_EN}) (?:${IMMIGRATION_STATUS_TERMS_EN}|immigration status|visa status|asylum (?:application|claim|case|interview|status))s?`,
      String.raw`${SUBJECT_EN}(?:applied for|am applying for|is applying for|was granted|were granted|received|claimed|am seeking|is seeking) asylum`,
      String.raw`(?:i am|i'm|he is|she is|they are|is|am|was) (?:an )?asylum seekers?`,
      String.raw`(?:i am|i'm|he is|she is|they are|is|am|was|were) (?:an )?(?:undocumented|illegal) (?:immigrant|migrant|alien)s?`,
      String.raw`overstayed (?:my |his |her |their |a )?visa`,
      String.raw`(?:was|were|got|been|being|facing) deport(?:ed|ation)`,
      String.raw`(?:zostal\p{L}*|bylem|bylam|byl|byla) deportowan\p{L}*`,
      String.raw`(?:${STATUS_VERBS_PL}|${POSSESSIVE_PL}) kart\p{L}* pobytu`,
      String.raw`(?:${STATUS_VERBS_PL}|${POSSESSIVE_PL}) zezwoleni\p{L}* na (?:pobyt|prace)`,
      String.raw`(?:${STATUS_VERBS_PL}) pobyt\p{L}* (?:staly|stalego|czasow\p{L}*|tolerowan\p{L}*)`,
      String.raw`(?:${STATUS_VERBS_PL}) status\p{L}* (?:uchodzcy|ukr)`,
      String.raw`(?:${STATUS_VERBS_PL}) ochron\p{L}* (?:czasow\p{L}*|miedzynarodow\p{L}*)`,
      String.raw`(?:ubiegam|ubiega|ubiegal\p{L}*) sie o azyl`,
      String.raw`(?:${STATUS_VERBS_UK}|${POSSESSIVE_UK}) посвідк\p{L}* на (?:постійне |тимчасове )?проживання`,
      String.raw`(?:${STATUS_VERBS_UK}|${POSSESSIVE_UK}) карт\p{L}* побиту`,
      String.raw`(?:${STATUS_VERBS_UK}|${POSSESSIVE_UK}) статус\p{L}* біженц\p{L}*`,
      String.raw`(?:${STATUS_VERBS_UK}|${POSSESSIVE_UK}) тимчасов\p{L}* захист\p{L}*`,
      String.raw`(?:${STATUS_VERBS_UK}|${POSSESSIVE_UK}) дозв\p{L}* на (?:проживання|працевлаштування)`,
      String.raw`(?:мене|нас|його|її) депортува\p{L}*`,
      String.raw`(?:був|була|були) депортован\p{L}*`,
      String.raw`(?:${STATUS_VERBS_UK}|попроси\p{L}*) політичн\p{L}* притул\p{L}*`,
    ],
  },
  {
    kind: 'criminal-history',
    sources: [
      String.raw`(?:${POSSESSIVE_EN}) (?:criminal|police|prison) (?:record|history|past)s?`,
      String.raw`(?:${POSSESSIVE_EN}) (?:prior |previous |past )?(?:felony |criminal )?convictions?`,
      String.raw`${SUBJECT_EN}(?:have|has|had|got|with) (?:a |an )?(?:criminal|police|prison) (?:record|history|past)`,
      String.raw`${SUBJECT_EN}(?:have|has|had|with) (?:a |an |two |several )?(?:prior|previous|felony|criminal) convictions?`,
      String.raw`(?:was|were|am|is|been|got|being) convicted`,
      String.raw`(?:served|serving|did|spent) (?:time|a sentence|\d+ (?:years?|months?)) (?:in )?(?:prison|jail)`,
      String.raw`served time`,
      String.raw`(?:on|out on|released on) parole`,
      String.raw`ex-?(?:con|convict|offender|prisoner)`,
      String.raw`(?:was|were|got|been) (?:incarcerated|imprisoned|jailed)`,
      String.raw`(?:went|sent) to (?:prison|jail)`,
      String.raw`(?:bylem|bylam|byl|byla|jestem|jest) karan\p{L}*`,
      String.raw`(?:moja|jego|jej) karalnosc`,
      String.raw`(?:mam|ma|dostal\p{L}*|otrzymal\p{L}*|uslyszal\p{L}*) wyrok\p{L}* skazujac\p{L}*`,
      String.raw`(?:zostal\p{L}*|bylem|bylam|byl|byla|jestem|jest) skazan\p{L}*`,
      String.raw`(?:siedzial\p{L}*|bylem|bylam|byl|byla) w (?:wiezieniu|areszcie|zakladzie karnym)`,
      String.raw`odsiedzia\p{L}*`,
      String.raw`odsiadu\p{L}*`,
      String.raw`(?:jestem|jest|wyszedl\p{L}*|wyszla) na warunkow\p{L}* zwolnieni\p{L}*`,
      String.raw`(?:маю|має|мав|мала|мають|з) судим(?:іст|ост)\p{L}*`,
      String.raw`(?:${POSSESSIVE_UK}) судим(?:іст|ост)\p{L}*`,
      String.raw`(?:я|він|вона|був|була|були) судим(?:ий|а|і)`,
      String.raw`(?:я|був|була|були|мене|його|її) засуджен\p{L}*`,
      String.raw`відбува\p{L}* покаранн\p{L}*`,
      String.raw`відбу\p{L}* (?:покаранн\p{L}*|термін|строк)`,
      String.raw`сид\p{L}* (?:у|в) (?:в'язниці|тюрмі|колонії)`,
    ],
  },
]

const compiledTopicalRules = topicalNeverStoreRules.map((rule) => {
  return {
    kind: rule.kind,
    expression: compileSensitiveTextExpression(
      rule.sources.map(foldPolishDiacritics),
    ),
    casedExpression: rule.casedSources
      ? compileSensitiveTextExpression(rule.casedSources)
      : null,
  }
})

/**
 * The topical never-store kinds (home address, immigration or residence
 * status, criminal history) found in a memory entry's text, matched over the
 * same normalized and diacritic-folded view as the sensitive-topic
 * classifier, plus a case-preserving view for the capitalised street shapes.
 * Only `evaluateMemoryEntry` calls it, so it rejects writes on every path
 * without redacting ordinary chat transcripts.
 */
export function detectTopicalNeverStoreKinds(
  text: string,
): TopicalNeverStoreKind[] {
  if (!text) {
    return []
  }

  const foldedText = foldPolishDiacritics(normalizeSensitiveText(text))
  const casedText = foldPolishDiacritics(normalizeSensitiveTextCase(text))

  return compiledTopicalRules
    .filter((rule) => {
      return rule.expression.test(foldedText)
        || !!rule.casedExpression?.test(casedText)
    })
    .map((rule) => {
      return rule.kind
    })
}
