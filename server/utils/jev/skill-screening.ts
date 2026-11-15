import type { Experimental_DecisionModel } from 'ai'
import { JEV_SKILL_SCREENING, JEV_SKILL_QUESTION_IDS } from '#shared/utils/jev-policy'
import type { JevSkillQuestionId } from '#shared/utils/jev-policy'
import { sha256Hex } from '#shared/utils/knowledge-hash'
import type { SkillFileKind } from '#shared/utils/skills-policy'
import { createSkillJevMark } from '#shared/utils/skills/jev-findings'
import type {
  SkillJevMark,
  SkillJevRange,
} from '#shared/utils/skills/jev-findings'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import { jevDecide } from '~~/server/utils/jev/client'
import type { JevStatus } from '~~/server/utils/jev/client'
import { splitTextWithLineRanges } from '~~/server/utils/jev/injection-screening'
import { recordJevRoleLog } from '~~/server/utils/jev/logging'
import type { JevLogger } from '~~/server/utils/jev/logging'
import { redactNeverStore } from '~~/server/utils/memory/compliance'

export interface SkillScreeningKv {
  get: (key: string) => Promise<string | null>
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<unknown>
}

export interface SkillScreeningFile {
  path: string
  kind: SkillFileKind
  text: string
}

export interface SkillScreeningInput {
  model: Experimental_DecisionModel
  userId: number
  kv: SkillScreeningKv
  description: string
  files: SkillScreeningFile[]
  maxCalls: number
  abortSignal?: AbortSignal
  logger?: JevLogger
}

export interface SkillScreeningOutcome {
  status: JevStatus
  marks: SkillJevMark[]
  unchecked: SkillJevRange[]
  tooLarge: boolean
  calls: number
  cachedChunks: number
  totalChunks: number
}

type ChunkScores = Record<JevSkillQuestionId, number>

interface SkillChunk extends SkillJevRange {
  text: string
  sha256: string
  redacted: number
}

interface RankedFile {
  file: SkillScreeningFile
  rank: number
}

const SCREENING_ROLE = 'injectionScreening'
const LOGGED_SOURCE = 'skill'
const DOCUMENT_EXTENSION_PATTERN = /\.(?:md|txt)$/i
const FRONTMATTER_FENCE_PATTERN = /^---[ \t]*$/
const FRONTMATTER_END_PATTERN = /^(?:---|\.\.\.)[ \t]*$/
const DESCRIPTION_KEY_PATTERN = /^description ?:/
const ANY_KEY_PATTERN = /^[A-Za-z0-9_-]+ ?:/

export function skillScreeningCacheKey(input: {
  userId: number
  chunkSha256: string
  descriptionSha256: string
}): string {
  return `skills:jev:u${input.userId}:${
    JEV_SKILL_SCREENING.questionSetVersion
  }:${input.chunkSha256}:${input.descriptionSha256}`
}

function rankFile(file: SkillScreeningFile): number {
  if (file.path === SKILL_MD_FILE_NAME || file.kind === 'skill-md') {
    return 0
  }

  if (file.kind === 'license') {
    return 4
  }

  if (file.kind === 'script') {
    return 3
  }

  if (file.kind === 'reference' || DOCUMENT_EXTENSION_PATTERN.test(file.path)) {
    return 1
  }

  return 2
}

/**
 * The send order: `SKILL.md`, then references and other `.md` and `.txt`
 * files, then other text, then scripts, then license files. The description
 * is sent before all of them (see `locateDescriptionLines`). Equal ranks
 * keep path order, so the order never depends on how the files were listed.
 */
export function orderFilesForScreening(
  files: SkillScreeningFile[],
): SkillScreeningFile[] {
  const ranked: RankedFile[] = files.map((file) => {
    return { file, rank: rankFile(file) }
  })

  ranked.sort((first, second) => {
    return first.rank - second.rank
      || first.file.path.localeCompare(second.file.path)
  })

  return ranked.map(entry => entry.file)
}

/**
 * The lines of the `description` field in the frontmatter of `SKILL.md`
 * (1-based, inclusive), or line 1 when the field cannot be found, so a mark
 * on the description always points inside `SKILL.md`.
 */
export function locateDescriptionLines(
  skillMarkdown: string | null,
): { startLine: number, endLine: number } {
  const fallback = { startLine: 1, endLine: 1 }

  if (!skillMarkdown) {
    return fallback
  }

  const lines = skillMarkdown.replace(/^\uFEFF/, '').split(/\r?\n/)

  if (!FRONTMATTER_FENCE_PATTERN.test(lines[0] ?? '')) {
    return fallback
  }

  const frontmatterEnd = lines.findIndex((line, index) => {
    return index > 0 && FRONTMATTER_END_PATTERN.test(line)
  })
  const limit = frontmatterEnd === -1 ? lines.length : frontmatterEnd
  const startIndex = lines.findIndex((line, index) => {
    return index > 0 && index < limit && DESCRIPTION_KEY_PATTERN.test(line)
  })

  if (startIndex === -1) {
    return fallback
  }

  let endIndex = startIndex

  while (
    endIndex + 1 < limit
    && !ANY_KEY_PATTERN.test(lines[endIndex + 1] ?? '')
  ) {
    endIndex++
  }

  return { startLine: startIndex + 1, endLine: endIndex + 1 }
}

async function toRedactedChunk(
  range: SkillJevRange,
  text: string,
): Promise<SkillChunk> {
  const redaction = redactNeverStore(text)

  return {
    ...range,
    text: redaction.text,
    sha256: await sha256Hex(redaction.text),
    redacted: redaction.blockedTotal,
  }
}

async function buildChunks(input: {
  description: string
  files: SkillScreeningFile[]
}): Promise<SkillChunk[]> {
  const chunks: SkillChunk[] = []
  const toChunk = async (
    range: SkillJevRange,
    text: string,
  ): Promise<SkillChunk> => {
    return chunks.length < JEV_SKILL_SCREENING.maxCallsPerStage
      ? await toRedactedChunk(range, text)
      : { ...range, text: '', sha256: '', redacted: 0 }
  }
  const skillMarkdown = input.files.find((file) => {
    return file.path === SKILL_MD_FILE_NAME
  })

  if (input.description.trim().length > 0) {
    chunks.push(await toChunk(
      {
        path: SKILL_MD_FILE_NAME,
        ...locateDescriptionLines(skillMarkdown?.text ?? null),
      },
      input.description,
    ))
  }

  for (const file of orderFilesForScreening(input.files)) {
    for (const part of splitTextWithLineRanges(
      file.text,
      JEV_SKILL_SCREENING.maxChunkTokens,
    )) {
      chunks.push(await toChunk(
        { path: file.path, startLine: part.startLine, endLine: part.endLine },
        part.text,
      ))
    }
  }

  return chunks
}

function isCompleteScores(value: unknown): value is ChunkScores {
  if (!value || typeof value !== 'object') {
    return false
  }

  return JEV_SKILL_QUESTION_IDS.every((id) => {
    const score = (value as Record<string, unknown>)[id]

    return typeof score === 'number' && Number.isFinite(score)
  })
}

async function readCachedScores(
  kv: SkillScreeningKv,
  key: string,
): Promise<ChunkScores | null> {
  try {
    const raw = await kv.get(key)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as { scores?: unknown }

    return isCompleteScores(parsed.scores) ? parsed.scores : null
  } catch {
    return null
  }
}

async function writeCachedScores(
  kv: SkillScreeningKv,
  key: string,
  scores: ChunkScores,
): Promise<void> {
  try {
    await kv.put(key, JSON.stringify({ scores }), {
      expirationTtl: JEV_SKILL_SCREENING.cacheTtlSeconds,
    })
  } catch {
    return
  }
}

function readAllScores(
  probabilities: Record<string, number>,
): ChunkScores | null {
  const scores: Partial<ChunkScores> = {}

  for (const id of JEV_SKILL_QUESTION_IDS) {
    const score = probabilities[id]

    if (typeof score !== 'number' || !Number.isFinite(score)) {
      return null
    }

    scores[id] = score
  }

  return scores as ChunkScores
}

function collectMarks(
  chunk: SkillChunk,
  scores: ChunkScores,
): SkillJevMark[] {
  return JEV_SKILL_QUESTION_IDS
    .filter((id) => {
      return scores[id] >= JEV_SKILL_SCREENING.flagAtOrAbove[id]
    })
    .map((id) => {
      return createSkillJevMark({
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        question: id,
        score: scores[id],
      })
    })
}

function mergeUncheckedRanges(
  chunks: SkillChunk[],
  isChecked: boolean[],
): SkillJevRange[] {
  const ranges: SkillJevRange[] = []
  let open: SkillJevRange | null = null

  for (const [index, chunk] of chunks.entries()) {
    if (isChecked[index]) {
      open = null

      continue
    }

    if (open && open.path === chunk.path) {
      open.startLine = Math.min(open.startLine, chunk.startLine)
      open.endLine = Math.max(open.endLine, chunk.endLine)

      continue
    }

    open = {
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
    }

    ranges.push(open)
  }

  return ranges
}

async function loadCachedChunkScores(input: {
  kv: SkillScreeningKv
  userId: number
  descriptionSha256: string
  chunks: SkillChunk[]
}): Promise<Map<string, ChunkScores>> {
  const scoresByHash = new Map<string, ChunkScores>()
  const considered = input.chunks.slice(0, JEV_SKILL_SCREENING.maxCallsPerStage)

  for (const chunk of considered) {
    if (scoresByHash.has(chunk.sha256)) {
      continue
    }

    const cached = await readCachedScores(input.kv, skillScreeningCacheKey({
      userId: input.userId,
      chunkSha256: chunk.sha256,
      descriptionSha256: input.descriptionSha256,
    }))

    if (cached) {
      scoresByHash.set(chunk.sha256, cached)
    }
  }

  return scoresByHash
}

/**
 * Asks Jev (`JEV_SKILL_SCREENING`) the six skill questions about every chunk
 * of a skill, in one call per chunk. The skill text only ever travels in the
 * state keys `text` (one chunk) and `description`; the questions are
 * constants. Never-store values are redacted from both before they are
 * hashed, cached or sent. Only the first `maxCallsPerStage` chunks of the send
 * order are ever considered, so later chunks carry a line range only.
 *
 * Scores are cached per user for 30 days by the hash of the redacted chunk
 * and of the redacted description (`k5_off_purpose` reads both), so the same
 * text costs nothing the second time and an update pays only for the chunks
 * that changed. At most `maxCalls` calls are made, in waves of
 * `maxConcurrentCalls`. Every chunk that was not reached, or whose call
 * failed (401, 403, 429, 529, timeout, network, refusal, a missing
 * probability), is returned as an unchecked line range. The result only adds
 * marks: it has no "clean" state, and a failed call never throws.
 */
export async function screenSkillText(
  input: SkillScreeningInput,
): Promise<SkillScreeningOutcome> {
  const startedAt = Date.now()
  const chunks = await buildChunks(input)
  const redactedDescription = redactNeverStore(input.description).text
  const descriptionSha256 = await sha256Hex(redactedDescription)
  const { maxCallsPerStage, maxConcurrentCalls } = JEV_SKILL_SCREENING
  const considered = chunks.slice(0, maxCallsPerStage)
  const scoresByHash = await loadCachedChunkScores({
    kv: input.kv,
    userId: input.userId,
    descriptionSha256,
    chunks,
  })
  const cachedChunks = considered.filter((chunk) => {
    return scoresByHash.has(chunk.sha256)
  }).length
  const queued = new Map<string, SkillChunk>()

  for (const chunk of considered) {
    if (!scoresByHash.has(chunk.sha256) && !queued.has(chunk.sha256)) {
      queued.set(chunk.sha256, chunk)
    }
  }

  const pending = [...queued.values()].slice(0, Math.max(0, input.maxCalls))
  let status: JevStatus = 'ok'
  let calls = 0
  let inputTokens = 0
  let cursor = 0

  while (cursor < pending.length && status === 'ok') {
    const wave = pending.slice(cursor, cursor + maxConcurrentCalls)

    cursor += wave.length

    const results = await Promise.all(wave.map((chunk) => {
      return jevDecide({
        model: input.model,
        state: {
          text: chunk.text,
          description: redactedDescription,
        },
        questions: { ...JEV_SKILL_SCREENING.questions },
        timeoutMs: JEV_SKILL_SCREENING.timeoutMs,
        abortSignal: input.abortSignal,
      })
    }))

    calls += results.length

    for (const [waveIndex, result] of results.entries()) {
      if (!result.ok) {
        status = result.status

        continue
      }

      inputTokens += result.inputTokens ?? 0

      const scores = readAllScores(result.probabilities)

      if (!scores) {
        status = 'error'

        continue
      }

      const chunk = wave[waveIndex]!

      scoresByHash.set(chunk.sha256, scores)

      await writeCachedScores(input.kv, skillScreeningCacheKey({
        userId: input.userId,
        chunkSha256: chunk.sha256,
        descriptionSha256,
      }), scores)
    }
  }

  const isChecked = chunks.map((chunk, index) => {
    return index < maxCallsPerStage && scoresByHash.has(chunk.sha256)
  })
  const marks = chunks.flatMap((chunk, index) => {
    return isChecked[index]
      ? collectMarks(chunk, scoresByHash.get(chunk.sha256)!)
      : []
  })
  const unchecked = mergeUncheckedRanges(chunks, isChecked)

  recordJevRoleLog(SCREENING_ROLE, {
    status,
    source: LOGGED_SOURCE,
    calls,
    questions: calls * JEV_SKILL_QUESTION_IDS.length,
    inputTokens,
    latencyMs: Date.now() - startedAt,
    counts: {
      skillChunks: chunks.length,
      skillCached: cachedChunks,
      skillMarked: marks.length,
      skillUnchecked: unchecked.length,
      skillRedacted: chunks.reduce((sum, chunk) => {
        return sum + chunk.redacted
      }, 0),
    },
  }, input.logger)

  return {
    status,
    marks,
    unchecked,
    tooLarge: chunks.length > maxCallsPerStage,
    calls,
    cachedChunks,
    totalChunks: chunks.length,
  }
}
