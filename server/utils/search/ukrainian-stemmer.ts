/**
 * Ukrainian suffix-stripping stemmer.
 *
 * Vendored from @orama/stemmers@3.1.18 (dist/uk.js), Apache License 2.0.
 * Lineage: Drupal `ukstemmer` -> `ukrstemmer-node` -> `@orama/stemmers`.
 * https://github.com/oramasearch/orama - Copyright OramaSearch Inc.
 * Licensed under the Apache License, Version 2.0.
 *
 * Changes from upstream:
 *  1. De-minified and ported to TypeScript with named regex constants.
 *  2. BUG FIX: the derivational `-ость` regex upstream carries the `g` flag
 *     and is used with `.test()`, which mutates `lastIndex` and makes the
 *     result alternate true/false on successive calls. The `g` flag is
 *     removed here. Verified upstream defect:
 *       /..(?<=о)сть?$/g.test('веселость') -> true,false,true,false...
 *  3. Module-level mutable state replaced with local variables.
 *  4. Consonant-alternation ("aggressive") pass is exposed and gated by a
 *     minimum-result-length guard (see stemUkrainianWord).
 */

const VOWEL = /[аеиоуюяіїє]/
const PERFECTIVE_GERUND = /(?:[иы]в(?:ши(?:сь)?)?|(?<=[ая])(?:в(?:ши(?:сь)?)?))$/
const REFLEXIVE = /с[яьи]$/
const ADJECTIVE = /(?:[аеєуюя]|еє|ем|єє|ий|их|іх|ів|ій|ім|їй|ім|им|ими|іми|йми|ої|ою|ова|ове|ого|ому)$/
const PARTICIPLE = /(?:[аіу]|ій|ий|им|ім|их|йми|ого|ому|ою)$/
const VERB = /(?:[еєую]|ав|али|ати|вши|ив|ити|ме|сь|ся|ши|учи|яти|ячи|ать|ять)$/
const NOUN = /(?:[аеєіїийоуыьюя]|ам|ах|ами|ев|еві|еи|ей|ем|ею|єм|єю|ів|їв|ий|ием|ию|ия|иям|иях|ов|ові|ой|ом|ою|ью|ья|ям|ями|ях)$/
const DERIVATIONAL = /[^аеиоуюяіїє][аеиоуюяіїє]+[^аеиоуюяіїє]+[аеиоуюяіїє].*(?<=о)сть?$/
const I_ENDING = /и$/
const OST_ENDING = /ость$/
const SOFT_SIGN = /ь$/
const SUPERLATIVE = /ейше$/
const DOUBLE_N = /нн$/
const CONSONANT_ALTERNATION = /(?:ст|ждж|дж|ьц|сі|ці|зі|он|ін|ів|ев|ок|шк|[гджзкстхцчш])$/

const MIN_AGGRESSIVE_STEM_LENGTH = 3

/** Soft (upstream default) stem: suffix stripping only. Lowercases input. */
export function softStemUkrainianWord(word: string): string {
  const lower = word.toLowerCase()
  const vowelMatch = VOWEL.exec(lower)

  if (!vowelMatch) {
    return lower
  }

  const head = lower.slice(0, vowelMatch.index + 1)
  let tail = lower.slice(vowelMatch.index + 1)

  if (tail === '') {
    return lower
  }

  const beforePerfectiveGerund = tail
  tail = tail.replace(PERFECTIVE_GERUND, '')

  if (tail === beforePerfectiveGerund) {
    tail = tail.replace(REFLEXIVE, '')

    const beforeAdjective = tail
    tail = tail.replace(ADJECTIVE, '')

    if (tail !== beforeAdjective) {
      tail = tail.replace(PARTICIPLE, '')
    } else {
      const beforeVerb = tail
      tail = tail.replace(VERB, '')

      if (tail === beforeVerb) {
        tail = tail.replace(NOUN, '')
      }
    }
  }

  tail = tail.replace(I_ENDING, '')

  if (DERIVATIONAL.test(tail)) {
    tail = tail.replace(OST_ENDING, '')
  }

  const beforeSoftSign = tail
  tail = tail.replace(SOFT_SIGN, '')

  if (tail === beforeSoftSign) {
    tail = tail.replace(SUPERLATIVE, '')
    tail = tail.replace(DOUBLE_N, 'н')
  }

  return head + tail
}

/**
 * Production stemmer. Applies the soft stem, then attempts the consonant-
 * alternation strip (which bridges velar mutations such as книга/книзі).
 * The aggressive result is accepted only when it is at least
 * MIN_AGGRESSIVE_STEM_LENGTH characters, which prevents the known
 * catastrophic over-stems (нога -> "но", вода -> "во", місто -> "мі").
 */
export function stemUkrainianWord(word: string): string {
  const soft = softStemUkrainianWord(word)
  const aggressive = soft.replace(CONSONANT_ALTERNATION, '')

  return aggressive !== soft && aggressive.length >= MIN_AGGRESSIVE_STEM_LENGTH
    ? aggressive
    : soft
}
