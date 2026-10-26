import { createError } from 'evlog'
import type { Experimental_DecisionQuestion } from 'ai'
import type { MemorySensitiveCategory } from '#shared/types/memory.d'
import type { MemoryInstructRejection } from '#shared/types/memory-instruct.d'
import { SENSITIVE_TOPIC_REFUSAL_MESSAGE } from '#shared/utils/memory-policy'
import {
  combineMemoryEntryText,
  evaluateMemoryEntry,
  redactNeverStore,
} from '~~/server/utils/memory/compliance'
import type { ComplianceLogger } from '~~/server/utils/memory/compliance'
import {
  memoryExtractionEvidenceNeedle,
} from '~~/server/utils/memory/extract-grounding'
import { JEV_BACKGROUND_TIMEOUT_MS, JEV_MODEL_ID } from '#shared/utils/jev-policy'
import {
  JEV_KEY_PROVIDER,
  classifyJevFailure,
  createJevDecisionModel,
  jevDecide,
} from '~~/server/utils/jev/client'
import type { JevProbabilities, JevStatus } from '~~/server/utils/jev/client'
import { resolveJevRoleApiKey } from '~~/server/utils/jev/roles'

type DbClient = ReturnType<typeof useDb>

export const MEMORY_JEV_MODEL_ID = JEV_MODEL_ID
export const MEMORY_JEV_TIMEOUT_MS = JEV_BACKGROUND_TIMEOUT_MS
export const MEMORY_JEV_SENSITIVE_THRESHOLD = 0.5
export const MEMORY_JEV_GROUNDING_THRESHOLD = 0.5
export const MEMORY_JEV_MAX_QUESTIONS_PER_CALL = 100
export const MEMORY_JEV_MAX_CHARS_PER_CALL = 90_000
export const MEMORY_JEV_SOURCE_WINDOW_CHARS = 300
export const MEMORY_JEV_MAX_SOURCE_CHARS = 9000
export const MEMORY_JEV_KEY_PROVIDER = JEV_KEY_PROVIDER
export const MEMORY_JEV_REJECTION_KIND = 'extra-check'
export const MEMORY_JEV_MODELS_URL = 'https://api.typesafe.ai/v1/models'
export const MEMORY_JEV_KEY_CHECK_TIMEOUT_MS = 5000

const UNAUTHORIZED_STATUSES = new Set([401, 403])
const NEVER_STORE_QUESTION = 'never-store'
const GROUNDED_QUESTION = 'grounded'
const QUESTION_ID_SEPARATOR = '__'
const NEVER_STORE_REFUSAL_MESSAGE
  = 'This memory contains data that cannot be stored'
const UNGROUNDED_REFUSAL_MESSAGE = 'This memory is not backed by your text'
const EXTRA_CHECK_PREFIX = 'TypeSafe AI\'s extra memory check'
const STATE_DESCRIPTION = 'Candidate entries for a personal AI assistant\'s '
  + 'long-term memory about its user. Every question quotes the one '
  + 'candidate entry it is about; judge that candidate only.'

const ART9_CATEGORY_DESCRIPTIONS = {
  'health': 'a specific person\'s physical or mental health: a diagnosis, '
    + 'illness, condition, disability, pregnancy, medication, therapy or '
    + 'medical treatment of that person',
  'religion-or-belief': 'a specific person\'s own religion, faith, religious '
    + 'practice, or philosophical belief such as atheism',
  'political-opinion': 'a specific person\'s own political opinion, how they '
    + 'vote, party they support, or political activism',
  'racial-or-ethnic-origin': 'a specific person\'s racial or ethnic origin',
  'sex-life-or-orientation': 'a specific person\'s sexual orientation, gender '
    + 'identity, or sex life',
  'trade-union': 'a specific person\'s membership or activity in a trade union',
  'genetic': 'a specific person\'s genetic data, DNA test results, or '
    + 'inherited genetic condition',
  'biometric': 'a specific person\'s biometric data used to identify them, '
    + 'such as fingerprints, face scans, iris or voice prints',
} as const satisfies Partial<Record<MemorySensitiveCategory, string>>

type JevSensitiveCategory = keyof typeof ART9_CATEGORY_DESCRIPTIONS

const jevSensitiveCategories = Object.keys(
  ART9_CATEGORY_DESCRIPTIONS,
) as JevSensitiveCategory[]

const SENSITIVE_FALSE_CRITERION = 'The candidate only mentions the subject as '
  + 'a TV show, place name, academic topic, job, workplace, or fiction, and '
  + 'reveals nothing about any person\'s own situation of this kind.'

export type MemoryJevStatus = JevStatus

export interface MemoryJevCandidate {
  title: string
  description: string
  body: string
  source?: string | null
}

export type MemoryJevVerdict
  = | { kind: 'clear' }
    | { kind: 'never-store' }
    | { kind: 'sensitive-topic', categories: MemorySensitiveCategory[] }
    | { kind: 'ungrounded' }

export type MemoryJevBlock = Exclude<MemoryJevVerdict, { kind: 'clear' }>

export interface MemoryJevChecker {
  check: (candidates: MemoryJevCandidate[]) => Promise<MemoryJevVerdict[]>
}

interface PreparedCandidate {
  index: number
  text: string
  source: string | null
  questionCount: number
  questionChars: number
}

interface MemoryJevTally {
  questions: number
  blocked: number
  groundingRejected: number
  gateDisagreements: Record<string, number>
  latencyMs: number
  status: MemoryJevStatus
}

const CLEAR_VERDICT: MemoryJevVerdict = { kind: 'clear' }

function questionId(candidateIndex: number, question: string): string {
  return `c${candidateIndex}${QUESTION_ID_SEPARATOR}${question}`
}

function passesDeterministicGate(text: string): boolean {
  return evaluateMemoryEntry({
    title: '',
    description: '',
    body: text,
    sensitivity: 'none',
  }).allowed
}

function prepareSource(source: string | null | undefined): string | null {
  const trimmed = source?.trim()

  if (!trimmed) {
    return null
  }

  const redacted = redactNeverStore(trimmed).text
    .slice(0, MEMORY_JEV_MAX_SOURCE_CHARS)

  return passesDeterministicGate(redacted) ? redacted : null
}

function prepareCandidate(
  candidate: MemoryJevCandidate,
  index: number,
): PreparedCandidate | null {
  const verdict = evaluateMemoryEntry({
    title: candidate.title,
    description: candidate.description,
    body: candidate.body,
    sensitivity: 'none',
  })

  if (!verdict.allowed) {
    return null
  }

  const text = combineMemoryEntryText(candidate).trim()

  if (!text) {
    return null
  }

  const source = prepareSource(candidate.source)
  const sensitivityQuestions = jevSensitiveCategories.length + 1
  const questionCount = sensitivityQuestions + (source === null ? 0 : 1)
  const questionChars = text.length * questionCount + (source?.length ?? 0)

  return { index, text, source, questionCount, questionChars }
}

function chunkCandidates(
  candidates: PreparedCandidate[],
): PreparedCandidate[][] {
  const chunks: PreparedCandidate[][] = []
  let current: PreparedCandidate[] = []
  let questions = 0
  let chars = 0

  for (const candidate of candidates) {
    const overflows = questions + candidate.questionCount
      > MEMORY_JEV_MAX_QUESTIONS_PER_CALL
      || chars + candidate.questionChars > MEMORY_JEV_MAX_CHARS_PER_CALL

    if (current.length > 0 && overflows) {
      chunks.push(current)
      current = []
      questions = 0
      chars = 0
    }

    current.push(candidate)
    questions += candidate.questionCount
    chars += candidate.questionChars
  }

  if (current.length > 0) {
    chunks.push(current)
  }

  return chunks
}

function buildCandidateQuestions(
  candidate: PreparedCandidate,
): Record<string, Experimental_DecisionQuestion> {
  const questions: Record<string, Experimental_DecisionQuestion> = {}

  for (const category of jevSensitiveCategories) {
    const description = ART9_CATEGORY_DESCRIPTIONS[category]

    questions[questionId(candidate.index, category)] = {
      type: 'boolean',
      instructions: {
        task: `Does the candidate memory entry reveal ${description}?`,
        candidate: candidate.text,
      },
      criteria: {
        true: `The candidate discloses ${description}, written in any `
          + 'language, even with typos or missing diacritics.',
        false: SENSITIVE_FALSE_CRITERION,
      },
    }
  }

  questions[questionId(candidate.index, NEVER_STORE_QUESTION)] = {
    type: 'boolean',
    instructions: {
      task: 'Does the candidate memory entry contain a secret value that '
        + 'must never be stored: a payment card number, bank account number, '
        + 'password, PIN, API key, access token, or government ID number?',
      candidate: candidate.text,
    },
    criteria: {
      true: 'An actual secret value is written in the candidate.',
      false: 'No actual secret value appears; a secret may be mentioned '
        + 'without its value.',
    },
  }

  if (candidate.source !== null) {
    questions[questionId(candidate.index, GROUNDED_QUESTION)] = {
      type: 'boolean',
      instructions: {
        task: 'Is the candidate memory entry stated or directly implied by '
          + 'the source text the user wrote?',
        candidate: candidate.text,
        source: candidate.source,
      },
    }
  }

  return questions
}

function readProbability(
  answers: JevProbabilities,
  candidateIndex: number,
  question: string,
): number | null {
  const probability = answers[questionId(candidateIndex, question)]

  return typeof probability === 'number' ? probability : null
}

function isFlagged(probability: number | null): boolean {
  return probability !== null
    && probability >= MEMORY_JEV_SENSITIVE_THRESHOLD
}

function isUngrounded(probability: number | null): boolean {
  return probability !== null
    && probability < MEMORY_JEV_GROUNDING_THRESHOLD
}

function readVerdict(
  answers: JevProbabilities,
  candidate: PreparedCandidate,
): MemoryJevVerdict {
  if (isFlagged(readProbability(
    answers,
    candidate.index,
    NEVER_STORE_QUESTION,
  ))) {
    return { kind: 'never-store' }
  }

  const categories = jevSensitiveCategories.filter((category) => {
    return isFlagged(readProbability(answers, candidate.index, category))
  })

  if (categories.length > 0) {
    return { kind: 'sensitive-topic', categories }
  }

  if (
    candidate.source !== null
    && isUngrounded(readProbability(
      answers,
      candidate.index,
      GROUNDED_QUESTION,
    ))
  ) {
    return { kind: 'ungrounded' }
  }

  return CLEAR_VERDICT
}

/**
 * Maps a failed Jev call to a status. Every status other than `ok` means
 * Jev was unavailable and the write continues on the deterministic gate
 * alone.
 */
export function classifyMemoryJevFailure(exception: unknown): MemoryJevStatus {
  return classifyJevFailure(exception)
}

function readLoggedTally(logger: ComplianceLogger): MemoryJevTally | null {
  const context = logger.getContext?.() as {
    attributes?: { memoryJev?: MemoryJevTally }
  } | undefined

  return context?.attributes?.memoryJev ?? null
}

function mergeCounts(
  left: Record<string, number>,
  right: Record<string, number>,
): Record<string, number> {
  const merged = { ...left }

  for (const [key, count] of Object.entries(right)) {
    merged[key] = (merged[key] ?? 0) + count
  }

  return merged
}

function recordTally(tally: MemoryJevTally, logger: ComplianceLogger): void {
  const previous = readLoggedTally(logger)

  logger.set({
    attributes: {
      memoryJev: {
        model: MEMORY_JEV_MODEL_ID,
        questions: (previous?.questions ?? 0) + tally.questions,
        blocked: (previous?.blocked ?? 0) + tally.blocked,
        groundingRejected: (previous?.groundingRejected ?? 0)
          + tally.groundingRejected,
        gateDisagreements: mergeCounts(
          previous?.gateDisagreements ?? {},
          tally.gateDisagreements,
        ),
        latencyMs: (previous?.latencyMs ?? 0) + tally.latencyMs,
        status: tally.status,
      },
    },
  })
}

function countVerdict(verdict: MemoryJevVerdict, tally: MemoryJevTally) {
  if (verdict.kind === 'ungrounded') {
    tally.groundingRejected += 1

    return
  }

  if (verdict.kind === 'never-store') {
    tally.blocked += 1
    tally.gateDisagreements = mergeCounts(tally.gateDisagreements, {
      [NEVER_STORE_QUESTION]: 1,
    })

    return
  }

  if (verdict.kind === 'sensitive-topic') {
    tally.blocked += 1
    tally.gateDisagreements = mergeCounts(
      tally.gateDisagreements,
      Object.fromEntries(verdict.categories.map(category => [category, 1])),
    )
  }
}

/**
 * Builds the TypeSafe AI Jev second opinion for one user's decrypted key.
 * `check` runs the deterministic gate on every candidate first and sends only
 * the candidates it allows, so text the gate already refused (and its
 * never-store values) never leaves Besidka. A source excerpt is redacted for
 * never-store values and dropped entirely when the gate would refuse it; a
 * candidate without a usable source gets no grounding question. Questions
 * are batched per call within the question and character caps, the calls
 * share one `MEMORY_JEV_TIMEOUT_MS` budget, and any failure (401, 429, 529,
 * network, timeout) leaves the remaining candidates `clear`, so Jev can only
 * add a block and never blocks a write when it is unavailable. Counts, never
 * text, are logged under `attributes.memoryJev`.
 */
export function createMemoryJevChecker(input: {
  apiKey: string
  logger?: ComplianceLogger
}): MemoryJevChecker | null {
  const createdModel = createJevDecisionModel(input.apiKey)

  if (!createdModel) {
    return null
  }

  const model = createdModel

  async function check(
    candidates: MemoryJevCandidate[],
  ): Promise<MemoryJevVerdict[]> {
    const verdicts: MemoryJevVerdict[] = candidates.map(() => CLEAR_VERDICT)
    const prepared = candidates
      .map(prepareCandidate)
      .filter((candidate): candidate is PreparedCandidate => {
        return candidate !== null
      })

    if (prepared.length === 0) {
      return verdicts
    }

    const tally: MemoryJevTally = {
      questions: 0,
      blocked: 0,
      groundingRejected: 0,
      gateDisagreements: {},
      latencyMs: 0,
      status: 'ok',
    }
    const abortSignal = AbortSignal.timeout(MEMORY_JEV_TIMEOUT_MS)
    const startedAt = Date.now()

    for (const chunk of chunkCandidates(prepared)) {
      const questions = Object.assign(
        {},
        ...chunk.map(buildCandidateQuestions),
      ) as Record<string, Experimental_DecisionQuestion>

      const result = await jevDecide({
        model,
        state: STATE_DESCRIPTION,
        questions,
        timeoutMs: MEMORY_JEV_TIMEOUT_MS,
        abortSignal,
      })

      if (!result.ok) {
        tally.status = result.status

        break
      }

      tally.questions += Object.keys(questions).length

      for (const candidate of chunk) {
        const verdict = readVerdict(result.probabilities, candidate)

        verdicts[candidate.index] = verdict
        countVerdict(verdict, tally)
      }
    }

    tally.latencyMs = Date.now() - startedAt

    if (input.logger) {
      recordTally(tally, input.logger)
    }

    return verdicts
  }

  return { check }
}

/**
 * Returns the Jev checker for the user's saved TypeSafe AI key, or `null`
 * when there is none or the user switched the `memoryChecks` role off.
 * Callers pass it only on paths that already passed the legal consent gate.
 * A failing key read or decryption is logged as `key-error` and also returns
 * `null`: Jev is optional, so it never turns into a failed write.
 */
export async function resolveMemoryJevChecker(input: {
  db: DbClient
  userId: number
  logger?: ComplianceLogger
}): Promise<MemoryJevChecker | null> {
  const apiKey = await resolveJevRoleApiKey({
    ...input,
    role: 'memoryChecks',
  })

  if (!apiKey) {
    return null
  }

  return createMemoryJevChecker({ apiKey, logger: input.logger })
}

/**
 * Cuts the grounding excerpt for an extraction op: the window of
 * `MEMORY_JEV_SOURCE_WINDOW_CHARS` around the first occurrence of the op's
 * evidence quote in the user's own (normalized) text, or the quote alone
 * when it is not found verbatim.
 */
export function buildMemoryJevGroundingExcerpt(
  evidence: string,
  collapsedTexts: string[],
): string {
  const needle = memoryExtractionEvidenceNeedle(evidence)

  if (!needle) {
    return ''
  }

  for (const text of collapsedTexts) {
    const start = text.indexOf(needle)

    if (start === -1) {
      continue
    }

    return text.slice(
      Math.max(0, start - MEMORY_JEV_SOURCE_WINDOW_CHARS),
      start + needle.length + MEMORY_JEV_SOURCE_WINDOW_CHARS,
    )
  }

  return needle
}

function describeCategories(categories: MemorySensitiveCategory[]): string {
  return categories.join(', ')
}

export function memoryJevRejection(
  verdict: MemoryJevBlock,
): MemoryInstructRejection {
  if (verdict.kind === 'never-store') {
    return {
      message: NEVER_STORE_REFUSAL_MESSAGE,
      why: `${EXTRA_CHECK_PREFIX} found a secret value such as a password, `
        + 'a card number or an ID number.',
      kind: MEMORY_JEV_REJECTION_KIND,
    }
  }

  if (verdict.kind === 'sensitive-topic') {
    return {
      message: SENSITIVE_TOPIC_REFUSAL_MESSAGE,
      why: `${EXTRA_CHECK_PREFIX} flagged this entry as sensitive data `
        + `(${describeCategories(verdict.categories)}).`,
      kind: MEMORY_JEV_REJECTION_KIND,
    }
  }

  return {
    message: UNGROUNDED_REFUSAL_MESSAGE,
    why: `${EXTRA_CHECK_PREFIX} could not find this entry in what you wrote.`,
    kind: MEMORY_JEV_REJECTION_KIND,
  }
}

/**
 * Asks Jev about one entry the deterministic gate already allowed and throws
 * the same 422 the gate would, marked `kind: 'extra-check'` in `data`, when
 * Jev flags it. A `null` checker or an unavailable Jev lets the write
 * through.
 */
export async function assertMemoryJevAllowed(
  checker: MemoryJevChecker | null | undefined,
  candidate: MemoryJevCandidate,
): Promise<void> {
  if (!checker) {
    return
  }

  const [verdict] = await checker.check([candidate])

  if (!verdict || verdict.kind === 'clear') {
    return
  }

  const rejection = memoryJevRejection(verdict)

  throw createError({
    message: rejection.message,
    status: 422,
    why: rejection.why,
    fix: 'Remove the flagged details and save again.',
    data: {
      kind: MEMORY_JEV_REJECTION_KIND,
      reason: verdict.kind,
    },
  })
}

export type MemoryJevKeyVerification = 'valid' | 'unauthorized' | 'unavailable'

/**
 * Checks a TypeSafe AI key before it is saved with one `GET /v1/models`
 * call. Only a 401 or 403 is `unauthorized`; a network error, a timeout or
 * any other status is `unavailable`, and the key is still saved, because
 * memory checks fail open to the deterministic gate anyway.
 */
export async function verifyMemoryJevApiKey(
  apiKey: string,
): Promise<MemoryJevKeyVerification> {
  try {
    const response = await fetch(MEMORY_JEV_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(MEMORY_JEV_KEY_CHECK_TIMEOUT_MS),
    })

    if (UNAUTHORIZED_STATUSES.has(response.status)) {
      return 'unauthorized'
    }

    return response.ok ? 'valid' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}
