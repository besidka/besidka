const EMPTY_ANSWER_FAILURE_TEXT = 'The model finished searching but didn\'t'
  + ' write an answer. Try again or pick another model.'

/**
 * The fixed notice persisted when a turn ran a follow-up-turn tool (Brave,
 * Exa, or Moonshot's Formula-API web search) but the model never produced
 * any visible text afterward — see `resolveToolLoopOptions` in
 * `server/utils/ai/tool-loop.ts` for why Anthropic in particular can still
 * end a turn this way even with the step budget exhausted. Kept as a fixed
 * string, mirroring `image-generation-errors.ts`'s `persistenceText`
 * pattern, so `isPersistedEmptyAnswerFailureText` can recognize it by exact
 * content and strip it from model context on a later turn — it must never
 * be echoed back as if it were real assistant content.
 */
export function getPersistedEmptyAnswerFailureText(): string {
  return EMPTY_ANSWER_FAILURE_TEXT
}

export function isPersistedEmptyAnswerFailureText(text: string): boolean {
  return text === EMPTY_ANSWER_FAILURE_TEXT
}
