import type { NeverStoreKind } from '#shared/types/memory.d'
import {
  compileSensitiveTextExpression,
  normalizeSensitiveText,
} from '~~/server/utils/memory/sensitivity'
import { foldPolishDiacritics } from '~~/server/utils/memory/text-folding'

type TopicalNeverStoreKind = Extract<
  NeverStoreKind,
  'home-address' | 'immigration-status' | 'criminal-history'
>

interface TopicalNeverStoreRule {
  kind: TopicalNeverStoreKind
  sources: readonly string[]
}

const HOUSE_NUMBER = String.raw`\d{1,5}[a-z]?`
const NAME_WORDS = String.raw`(?:\p{L}[\p{L}'.-]* ){1,3}`
const NAME_WORDS_WITH_COMMA = String.raw`(?:\p{L}[\p{L}'.-]*,? ){1,3}`
const SHORT_GAP = String.raw`[^\n\d]{0,30}`

const ADDRESS_SEPARATOR = String.raw`(?: is| -| —|:)\s*`
const STREET_WORDS_EN = 'street|avenue|boulevard|blvd'
const STREET_ABBREVIATIONS_PL = 'ul'
const STREET_ABBREVIATIONS_UK = 'вул|просп|пров|бульв|пл'

const ADDRESS_QUALIFIERS_EN = 'home |postal |mailing |residential |street '

/**
 * Deterministic, deliberately narrow shapes for the topical never-store
 * kinds that used to rely on the extractor label alone. Each source is
 * written lowercase and without Polish diacritics, the form the input is
 * folded to, and needs a strong signal (a street keyword next to a house
 * number, an address cue next to a number, or a status term), so ordinary
 * mentions such as an address book app or a crime TV show are not caught.
 */
const topicalNeverStoreRules: readonly TopicalNeverStoreRule[] = [
  {
    kind: 'home-address',
    sources: [
      String.raw`${HOUSE_NUMBER} ${NAME_WORDS}(?:${STREET_WORDS_EN})`,
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
  },
  {
    kind: 'immigration-status',
    sources: [
      String.raw`(?:residence|residency|resident|work) permits?`,
      String.raw`green card`,
      String.raw`asylum (?:seeker|application|claim|status|case|interview)s?`,
      String.raw`(?:seeking|seek|applied for|applying for|granted|claimed|claiming) asylum`,
      String.raw`refugee status`,
      String.raw`temporary protection`,
      String.raw`immigration status`,
      String.raw`visa status`,
      String.raw`(?:undocumented|illegal) (?:immigrant|migrant|alien)s?`,
      String.raw`overstayed (?:my |his |her |their |a )?visa`,
      String.raw`(?:was|were|got|been|being|facing) deport(?:ed|ation)`,
      String.raw`(?:zostal\p{L}*|bylem|bylam|byl|byla) deportowan\p{L}*`,
      String.raw`kart\p{L}* pobytu`,
      String.raw`zezwoleni\p{L}* na (?:pobyt|prace)`,
      String.raw`pobyt\p{L}* (?:staly|stalego|czasow\p{L}*|tolerowan\p{L}*)`,
      String.raw`status\p{L}* (?:uchodzcy|ukr)`,
      String.raw`ochron\p{L}* (?:czasow\p{L}*|miedzynarodow\p{L}*)`,
      String.raw`(?:ubiegam|ubiega|ubiegal\p{L}*) sie o azyl`,
      String.raw`посвідк\p{L}* на (?:постійне |тимчасове )?проживання`,
      String.raw`карт\p{L}* побиту`,
      String.raw`статус\p{L}* біженц\p{L}*`,
      String.raw`тимчасов\p{L}* захист\p{L}*`,
      String.raw`дозв\p{L}* на (?:проживання|працевлаштування)`,
      String.raw`(?:мене|нас|його|її) депортува\p{L}*`,
      String.raw`(?:був|була|були) депортован\p{L}*`,
      String.raw`політичн\p{L}* притул\p{L}*`,
    ],
  },
  {
    kind: 'criminal-history',
    sources: [
      String.raw`criminal (?:record|history|conviction|past)s?`,
      String.raw`(?:prior|previous|felony|criminal|past) convictions?`,
      String.raw`(?:was|were|am|is|been|got|being) convicted`,
      String.raw`convicted (?:of|for)`,
      String.raw`(?:served|serving|did|spent) (?:time|a sentence|\d+ (?:years?|months?)) (?:in )?(?:prison|jail)`,
      String.raw`served time`,
      String.raw`(?:on|out on|released on) parole`,
      String.raw`ex-?(?:con|convict|offender|prisoner)`,
      String.raw`(?:was|were|got|been) (?:incarcerated|imprisoned|jailed)`,
      String.raw`(?:went|sent) to (?:prison|jail)`,
      String.raw`(?:i|he|she|they) (?:have|has|had) a (?:criminal )?record`,
      String.raw`karaln\p{L}*`,
      String.raw`(?:bylem|bylam|byl|byla|jestem|jest) karan\p{L}*`,
      String.raw`wyrok\p{L}* skazujac\p{L}*`,
      String.raw`skazan\p{L}* (?:za|na)`,
      String.raw`(?:siedzial\p{L}*|bylem|bylam|byl|byla) w (?:wiezieniu|areszcie|zakladzie karnym)`,
      String.raw`odsiedzia\p{L}*`,
      String.raw`odsiadu\p{L}*`,
      String.raw`warunkow\p{L}* zwolnien\p{L}*`,
      String.raw`судим(?:іст|ост)\p{L}*|судим(?:ий|а|і)`,
      String.raw`(?:я|був|була|були|мене|його|її) засуджен\p{L}*`,
      String.raw`відбува\p{L}* покаранн\p{L}*`,
      String.raw`відбу\p{L}* (?:покаранн\p{L}*|термін|строк)`,
      String.raw`сид\p{L}* (?:у|в) (?:в'язниці|тюрмі|колонії)`,
      String.raw`умовно-?достроков\p{L}*`,
    ],
  },
]

const compiledTopicalRules = topicalNeverStoreRules.map((rule) => {
  return {
    kind: rule.kind,
    expression: compileSensitiveTextExpression(
      rule.sources.map(foldPolishDiacritics),
    ),
  }
})

/**
 * The topical never-store kinds (home address, immigration or residence
 * status, criminal history) found in a memory entry's text, matched over the
 * same normalized and diacritic-folded view as the sensitive-topic
 * classifier. Only `evaluateMemoryEntry` calls it, so it rejects writes on
 * every path without redacting ordinary chat transcripts.
 */
export function detectTopicalNeverStoreKinds(
  text: string,
): TopicalNeverStoreKind[] {
  if (!text) {
    return []
  }

  const foldedText = foldPolishDiacritics(normalizeSensitiveText(text))

  return compiledTopicalRules
    .filter((rule) => {
      return rule.expression.test(foldedText)
    })
    .map((rule) => {
      return rule.kind
    })
}
