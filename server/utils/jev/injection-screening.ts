import type { Experimental_DecisionModel } from 'ai'
import { JEV_INJECTION_SCREENING } from '#shared/utils/jev-policy'
import {
  countKnowledgeChars,
  estimateKnowledgeTextTokens,
} from '#shared/utils/project-knowledge-budget'
import { KNOWLEDGE_CHARS_PER_TOKEN } from '#shared/utils/project-knowledge-policy'
import { jevDecide } from '~~/server/utils/jev/client'
import type { JevStatus } from '~~/server/utils/jev/client'
import { recordJevRoleLog } from '~~/server/utils/jev/logging'
import type { JevLogger } from '~~/server/utils/jev/logging'
import { redactNeverStore } from '~~/server/utils/memory/compliance'

export type InjectionVerdict = 'flagged' | 'clean' | 'unscreened'

export type InjectionScreeningSource = 'knowledge' | 'search'

export interface InjectionScreeningInput {
  model: Experimental_DecisionModel
  texts: string[]
  source: InjectionScreeningSource
  timeoutMs: number
  maxCalls?: number
  abortSignal?: AbortSignal
  logger?: JevLogger
}

interface ScreeningTask {
  textIndex: number
  chunk: string
}

interface TextProgress {
  pendingChunks: number
  isFlagged: boolean
  maxScore: number | null
}

const TOKEN_FAMILY = 'default'
const LINE_BREAK_PATTERN = /(?<=\n)/
const SCREENING_ROLE = 'injectionScreening'
const INJECTION_VERDICTS: readonly InjectionVerdict[] = [
  'flagged',
  'clean',
  'unscreened',
]
const VERDICT_COUNT_SUFFIXES: Record<InjectionVerdict, string> = {
  flagged: 'Flagged',
  clean: 'Clean',
  unscreened: 'Unscreened',
}

function estimateTokens(text: string): number {
  return estimateKnowledgeTextTokens(countKnowledgeChars(text), TOKEN_FAMILY)
}

function hardSliceChars(maxTokens: number): number {
  const charsPerToken = KNOWLEDGE_CHARS_PER_TOKEN[TOKEN_FAMILY]
  const fewestCharsPerToken = Math.min(
    charsPerToken.latin,
    charsPerToken.cyrillic,
    charsPerToken.other,
  )

  return Math.max(1, Math.floor(maxTokens * fewestCharsPerToken))
}

function sliceLongLine(line: string, maxChars: number): string[] {
  const characters = Array.from(line)

  if (characters.length <= maxChars) {
    return [line]
  }

  const slices: string[] = []

  for (let start = 0; start < characters.length; start += maxChars) {
    slices.push(characters.slice(start, start + maxChars).join(''))
  }

  return slices
}

/**
 * Splits text into chunks of at most `maxTokens` estimated tokens (the
 * Cyrillic-aware knowledge estimate), cutting at line breaks. A line longer
 * than a chunk is cut into slices that fit even when every character costs
 * the most tokens. Whitespace-only chunks are dropped.
 */
export function splitTextForInjectionScreening(
  text: string,
  maxTokens: number = JEV_INJECTION_SCREENING.maxChunkTokens,
): string[] {
  const maxChars = hardSliceChars(maxTokens)
  const pieces = text.split(LINE_BREAK_PATTERN).flatMap((line) => {
    return sliceLongLine(line, maxChars)
  })
  const chunks: string[] = []
  let current = ''
  let currentTokens = 0

  for (const piece of pieces) {
    const pieceTokens = estimateTokens(piece)

    if (current && currentTokens + pieceTokens > maxTokens) {
      chunks.push(current)
      current = ''
      currentTokens = 0
    }

    current += piece
    currentTokens += pieceTokens
  }

  if (current) {
    chunks.push(current)
  }

  return chunks.filter(chunk => chunk.trim().length > 0)
}

function buildTasks(texts: string[]): {
  tasks: ScreeningTask[]
  progress: TextProgress[]
} {
  const tasks: ScreeningTask[] = []
  const progress = texts.map((text, textIndex) => {
    const chunks = splitTextForInjectionScreening(text)

    for (const chunk of chunks) {
      tasks.push({ textIndex, chunk: redactNeverStore(chunk).text })
    }

    return { pendingChunks: chunks.length, isFlagged: false, maxScore: null }
  })

  return { tasks, progress }
}

function toVerdict(entry: TextProgress): InjectionVerdict {
  if (entry.isFlagged) {
    return 'flagged'
  }

  return entry.pendingChunks === 0 ? 'clean' : 'unscreened'
}

function countVerdicts(
  verdicts: InjectionVerdict[],
  source: InjectionScreeningSource,
): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const verdict of INJECTION_VERDICTS) {
    counts[`${source}${VERDICT_COUNT_SUFFIXES[verdict]}`] = verdicts.filter(
      candidate => candidate === verdict,
    ).length
  }

  return counts
}

/**
 * Asks Jev (`JEV_INJECTION_SCREENING`) whether each text attempts a prompt
 * injection. Every text is split into chunks of about `maxChunkTokens`,
 * never-store values are redacted from each chunk before it is sent, and a
 * text is `flagged` as soon as one chunk scores at or above `flagAtOrAbove`
 * (its other chunks are not sent). Calls run in waves of at most
 * `maxConcurrentCalls`. The first failed call (401, 429, timeout, network,
 * refusal) stops screening, and so does reaching `maxCalls` (a per-request
 * budget): every text not yet decided is `unscreened`, which callers treat
 * as today's behaviour or queue for a later pass. It never throws and logs
 * counts and scores only, under `attributes.injectionScreeningJev`.
 */
export async function screenTextsForInjection(
  input: InjectionScreeningInput,
): Promise<InjectionVerdict[]> {
  const { tasks, progress } = buildTasks(input.texts)
  const { questionId, question, flagAtOrAbove, maxConcurrentCalls }
    = JEV_INJECTION_SCREENING
  const maxCalls = input.maxCalls ?? Number.POSITIVE_INFINITY
  const startedAt = Date.now()
  let status: JevStatus = 'ok'
  let calls = 0
  let inputTokens = 0
  let cursor = 0

  while (cursor < tasks.length && status === 'ok' && calls < maxCalls) {
    const wave: ScreeningTask[] = []

    while (
      cursor < tasks.length
      && wave.length < maxConcurrentCalls
      && calls + wave.length < maxCalls
    ) {
      const task = tasks[cursor]!

      cursor++

      if (!progress[task.textIndex]!.isFlagged) {
        wave.push(task)
      }
    }

    const results = await Promise.all(wave.map((task) => {
      return jevDecide({
        model: input.model,
        state: { text: task.chunk },
        questions: { [questionId]: question },
        timeoutMs: input.timeoutMs,
        abortSignal: input.abortSignal,
      })
    }))

    calls += results.length

    for (const [waveIndex, result] of results.entries()) {
      const entry = progress[wave[waveIndex]!.textIndex]!

      if (!result.ok) {
        status = result.status

        continue
      }

      inputTokens += result.inputTokens ?? 0

      const score = result.probabilities[questionId]

      if (typeof score !== 'number') {
        status = 'error'

        continue
      }

      entry.pendingChunks--
      entry.maxScore = Math.max(entry.maxScore ?? 0, score)

      if (score >= flagAtOrAbove) {
        entry.isFlagged = true
      }
    }
  }

  const verdicts = progress.map(toVerdict)

  if (calls > 0) {
    recordJevRoleLog(SCREENING_ROLE, {
      status,
      calls,
      questions: calls,
      inputTokens,
      latencyMs: Date.now() - startedAt,
      counts: countVerdicts(verdicts, input.source),
      scores: progress.flatMap((entry) => {
        return entry.maxScore === null ? [] : [entry.maxScore]
      }),
    }, input.logger)
  }

  return verdicts
}
