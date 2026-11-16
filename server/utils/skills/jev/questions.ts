import { JEV_SKILL_SELECTION } from '#shared/utils/jev-policy'
import type { JevQuestions } from '~~/server/utils/jev/client'
import type { SendPathJevExtra } from '~~/server/utils/jev/send-path'
import { redactNeverStore } from '~~/server/utils/memory/compliance'
import { toSkillSingleLine } from '~~/server/utils/skills/runtime/text'

export interface SkillSelectionLine {
  name: string
  description: string
}

function skillStateKey(index: number): string {
  return `${JEV_SKILL_SELECTION.stateKeyPrefix}${index}`
}

function skillQuestionId(index: number): string {
  return `${JEV_SKILL_SELECTION.questionIdPrefix}${index}`
}

function toSkillStateLine(skill: SkillSelectionLine): string {
  const line = toSkillSingleLine(`${skill.name}: ${skill.description}`)

  return redactNeverStore(line).text
    .slice(0, JEV_SKILL_SELECTION.maxCatalogLineChars)
}

/**
 * The shared state and questions for the candidates: one top-level state
 * key per skill (`skill_<i>`, the name and description cut at
 * `maxCatalogLineChars`, never-store removed) and one boolean question per
 * skill that only names its key. A description is third-party text, so it
 * never sits in a question's instructions, where it could steer its own
 * score (the pattern of `rerank.ts`).
 */
export function buildSkillSelectionJev(
  skills: readonly SkillSelectionLine[],
): SendPathJevExtra {
  const state: Record<string, string> = {}
  const questions: JevQuestions = {}

  skills.forEach((skill, index) => {
    state[skillStateKey(index)] = toSkillStateLine(skill)
    questions[skillQuestionId(index)] = {
      type: 'boolean',
      instructions: JEV_SKILL_SELECTION.task.replace(
        JEV_SKILL_SELECTION.statePlaceholder,
        skillStateKey(index),
      ),
      criteria: JEV_SKILL_SELECTION.criteria,
    }
  })

  return { state, questions }
}

/**
 * The index of the best candidate scoring at or above `applyAtOrAbove`, the
 * earlier (better prefiltered) one winning a tie. A missing or non-finite
 * answer is skipped, so a partial answer can still pick a skill.
 */
export function pickSkillByScore(
  probabilities: Record<string, number>,
  count: number,
  applyAtOrAbove: number = JEV_SKILL_SELECTION.applyAtOrAbove,
): { index: number | null, scores: number[] } {
  const scores: number[] = []
  let bestIndex: number | null = null
  let bestScore = -1

  for (let index = 0; index < count; index++) {
    const score = probabilities[skillQuestionId(index)]

    if (typeof score !== 'number' || !Number.isFinite(score)) {
      continue
    }

    scores.push(score)

    if (score >= applyAtOrAbove && score > bestScore) {
      bestIndex = index
      bestScore = score
    }
  }

  return { index: bestIndex, scores }
}
