import MiniSearch from 'minisearch'
import { JEV_SKILL_SELECTION } from '#shared/utils/jev-policy'
import { STOP_WORDS } from '~~/server/utils/knowledge/search'
import {
  buildStemmedSearchText,
  tokenizeSearchText,
} from '~~/server/utils/search/tokens'

export interface SkillPrefilterSkill {
  id: string
  name: string
  description: string
}

export interface SkillPrefilterCandidate<
  Skill extends SkillPrefilterSkill = SkillPrefilterSkill,
> {
  skill: Skill
  score: number
  matchedTerms: number
}

export interface SkillPrefilterOptions {
  minScore?: number
  minMatchedTerms?: number
  maxCandidates?: number
}

const STEM_SEPARATOR = /\s+/

const MESSAGE_FILLER_WORDS = [
  'this', 'that', 'these', 'those', 'but', 'not', 'have', 'has', 'had',
  'been', 'being', 'will', 'would', 'should', 'must', 'might', 'also',
  'just', 'than', 'then', 'them', 'they', 'their', 'there', 'here',
  'between', 'before', 'after', 'over', 'under', 'into', 'only', 'very',
  'much', 'many', 'more', 'most', 'some', 'any', 'all', 'each', 'every',
  'other', 'such', 'same', 'too', 'our', 'your', 'its', 'about', 'because',
  'while', 'whether', 'yes', 'get', 'got', 'make', 'made', 'need', 'want',
  'give', 'help', 'use', 'used', 'like', 'look', 'say', 'tell', 'take',
  'think', 'know', 'let', 'does', 'done', 'new', 'old', 'first', 'last',
  'good', 'best', 'way', 'ways', 'difference', 'different',
  'something', 'anything', 'thing', 'things', 'again', 'still',
  'today', 'tomorrow', 'sometimes', 'really', 'tried', 'trying',
]

const STOP_WORD_STEMS = new Set(
  buildStemmedSearchText([...STOP_WORDS, ...MESSAGE_FILLER_WORDS].join(' '))
    .split(STEM_SEPARATOR),
)

const RARE_TERM_FLOOR_SHARE = 0.6
const BM25_IDF_OFFSET = 0.5

interface SkillDocument {
  id: string
  stem: string
}

function stemSkillText(skill: SkillPrefilterSkill): string {
  return buildStemmedSearchText(
    `${tokenizeSearchText(skill.name).join(' ')} ${skill.description}`,
  )
}

/**
 * The distinct stemmed terms of a message that can say anything about a
 * skill: stop words and tokens shorter than `minTermLength` are dropped, and
 * only the first `maxQueryTerms` stay, so a pasted document cannot turn the
 * prefilter into a scan.
 */
export function buildSkillQueryTerms(message: string): string[] {
  const { minTermLength, maxQueryTerms } = JEV_SKILL_SELECTION.prefilter
  const terms = buildStemmedSearchText(message)
    .split(STEM_SEPARATOR)
    .filter((term) => {
      return term.length >= minTermLength && !STOP_WORD_STEMS.has(term)
    })

  return [...new Set(terms)].slice(0, maxQueryTerms)
}

/**
 * The floor `minScore` is a BM25 score, which falls with the number of
 * skills: the best a single term can score is the idf of a term found in one
 * skill. With few skills that is below `minScore`, so the floor is capped at
 * a share of it and a user with one or two skills is not locked out.
 */
export function resolveSkillMinScore(
  minScore: number,
  skillCount: number,
): number {
  const rareTermScore = Math.log(
    1 + (skillCount - 1 + BM25_IDF_OFFSET) / (1 + BM25_IDF_OFFSET),
  )

  return Math.min(minScore, rareTermScore * RARE_TERM_FLOOR_SHARE)
}

/**
 * The free local half of skill selection: BM25 over the stemmed names and
 * descriptions of `skills`, best first, at most `maxCandidates`. A skill
 * stays only when its score is at least `minScore` and at least
 * `minMatchedTerms` distinct query terms hit it, which keeps one shared
 * common word from admitting a skill whatever the size of the corpus. No
 * candidate means no Jev call at all. Nothing leaves the process.
 */
export function prefilterSkills<Skill extends SkillPrefilterSkill>(
  skills: readonly Skill[],
  message: string,
  options: SkillPrefilterOptions = {},
): Array<SkillPrefilterCandidate<Skill>> {
  const {
    minScore = JEV_SKILL_SELECTION.prefilter.minScore,
    minMatchedTerms = JEV_SKILL_SELECTION.prefilter.minMatchedTerms,
    maxCandidates = JEV_SKILL_SELECTION.maxCandidates,
  } = options
  const terms = buildSkillQueryTerms(message)

  if (skills.length === 0 || terms.length === 0) {
    return []
  }

  const skillsById = new Map(skills.map(skill => [skill.id, skill]))
  const index = new MiniSearch<SkillDocument>({
    fields: ['stem'],
    tokenize: text => text.split(STEM_SEPARATOR).filter(Boolean),
    processTerm: term => term,
    searchOptions: { prefix: false, fuzzy: false, combineWith: 'OR' },
  })

  index.addAll(skills.map((skill) => {
    return { id: skill.id, stem: stemSkillText(skill) }
  }))

  const scoreFloor = resolveSkillMinScore(minScore, skills.length)

  return index.search(terms.join(' '))
    .filter((result) => {
      return result.score >= scoreFloor
        && result.queryTerms.length >= minMatchedTerms
    })
    .slice(0, maxCandidates)
    .map((result) => {
      return {
        skill: skillsById.get(result.id as string)!,
        score: result.score,
        matchedTerms: result.queryTerms.length,
      }
    })
}
