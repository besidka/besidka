import type {
  ComplianceBlockedCounts,
  MemoryCategory,
  MemoryOrigin,
  MemorySensitiveCategory,
} from '#shared/types/memory.d'
import {
  MEMORY_LIMITS,
  alwaysInjectedMemoryCategories,
} from '#shared/utils/memory-policy'
import {
  memoryByteLength,
  memoryEntryInputSchema,
  memoryEntryPatchSchema,
} from '#shared/utils/memory-schemas'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { decodePublicId } from '~~/server/utils/custom-db-types'
import { insertGuardedMemoryEntry } from '~~/server/utils/memory/entries'
import { chatIsMemoryIncluded } from '~~/server/utils/memory/chat-memory-filters'
import {
  evaluateMemoryEntry,
  recordSensitiveDetection,
} from '~~/server/utils/memory/compliance'
import type { ComplianceLogger } from '~~/server/utils/memory/compliance'
import type { MemoryExtractionOp } from '~~/server/utils/memory/extract-schema'
import {
  MEMORY_EXTRACTION_EDITABLE_ORIGINS,
} from '~~/server/utils/memory/extract-limits'
import {
  isMemoryExtractionEvidenceGrounded,
  prepareMemoryExtractionGroundingText,
} from '~~/server/utils/memory/extract-grounding'
import type {
  MemoryExtractionGroundingText,
} from '~~/server/utils/memory/extract-grounding'
import {
  memoryExtractionNormalizeText,
} from '~~/server/utils/memory/extract-input'
import { buildMemoryJevGroundingExcerpt } from '~~/server/utils/memory/jev-check'
import type {
  MemoryJevChecker,
  MemoryJevVerdict,
} from '~~/server/utils/memory/jev-check'
import type {
  MemoryExtractionIndexEntry,
} from '~~/server/utils/memory/extract-input'

type DbClient = ReturnType<typeof useDb>

type MergeCounter = 'updated' | 'appended'

const STALE_ROW = 'stale-row'

type MergeFieldsBuilder = (
  base: MemoryExtractionIndexEntry,
) => MemoryExtractionPatchFields | DropOutcome

const COMPLIANCE_ORIGIN = 'memory-extraction'
const CHAT_UNAVAILABLE_DROP_REASON = 'chat-unavailable'
const FALLBACK_SLUG_PREFIX = 'entry'
const UNIQUE_VIOLATION_MARKER = 'UNIQUE constraint'
const SENSITIVE_TOPIC_DROP_REASON = 'sensitive-topic'
const JEV_SENSITIVE_DROP_REASON = 'extra-check-sensitive'
const JEV_UNGROUNDED_DROP_REASON = 'extra-check-ungrounded'
const HASH_MULTIPLIER = 31
const HASH_RADIX = 36
const SLUG_SEPARATOR_PATTERN = /[^a-z0-9]+/gu
const SLUG_EDGE_PATTERN = /^-+|-+$/gu
const COMBINING_MARKS_PATTERN = /\p{M}/gu
const BODY_LINE_SEPARATOR_PATTERN = /\r?\n/u
const BODY_BULLET_PREFIX_PATTERN = /^[-*•]\s+/u
const BODY_LINE_TRAILING_PUNCTUATION_PATTERN = /[.;,]+$/u
const BODY_LINE_JOINER = '\n'
const LINK_TRAILING_PUNCTUATION_PATTERN = /[.,;:!?)\]}>]+$/u
const LINK_PATTERNS = [
  /https?:\/\/[^\s<>"'`)\]]+/giu,
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu,
  /(?:[\p{L}\p{N}-]+\.)+[a-z]{2,}(?![\p{L}\p{N}-])/giu,
] as const

const CYRILLIC_TRANSLITERATION: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'h',
  ґ: 'g',
  д: 'd',
  е: 'e',
  є: 'ie',
  ж: 'zh',
  з: 'z',
  и: 'y',
  і: 'i',
  ї: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ь: '',
  ъ: '',
  ы: 'y',
  э: 'e',
  ю: 'iu',
  я: 'ia',
}

export interface MemoryExtractionApplyInput {
  ops: MemoryExtractionOp[]
  maxOps: number
  db: DbClient
  userId: number
  projectId: string | null
  chatId: string | null
  entries: MemoryExtractionIndexEntry[]
  groundingTexts: string[]
  createGroundingTexts?: string[]
  origin?: Extract<MemoryOrigin, 'extraction' | 'import'>
  logger?: ComplianceLogger
  jev?: MemoryJevChecker | null
}

export interface MemoryExtractionApplyResult {
  proposed: number
  created: number
  updated: number
  appended: number
  deleted: number
  dropped: Record<string, number>
  blocked: ComplianceBlockedCounts
}

interface MemoryExtractionPatchFields {
  title?: string
  description?: string
  body?: string
}

interface PersistedEntryValues {
  category: MemoryCategory
  title: string
  description: string
  body: string
  sensitivity: 'none'
  sensitiveCategory: null
}

interface DropOutcome {
  dropped: string
}

function memoryExtractionHash(value: string): string {
  let hash = 0

  for (const character of value) {
    hash = (hash * HASH_MULTIPLIER + character.codePointAt(0)!) >>> 0
  }

  return hash.toString(HASH_RADIX)
}

export function memoryExtractionSlugFromTitle(title: string): string {
  const transliterated = [...title.toLowerCase()]
    .map(character => CYRILLIC_TRANSLITERATION[character] ?? character)
    .join('')
    .normalize('NFKD')
    .replace(COMBINING_MARKS_PATTERN, '')
  const slug = transliterated
    .replace(SLUG_SEPARATOR_PATTERN, '-')
    .replace(SLUG_EDGE_PATTERN, '')
    .slice(0, MEMORY_LIMITS.maxSlugChars)
    .replace(SLUG_EDGE_PATTERN, '')

  if (slug) {
    return slug
  }

  return `${FALLBACK_SLUG_PREFIX}-${memoryExtractionHash(title)}`
}

function memoryExtractionEntryKey(category: string, slug: string): string {
  return `${category}/${slug}`
}

function memoryExtractionIsUniqueViolation(exception: unknown): boolean {
  let current: unknown = exception

  for (let depth = 0; depth < 4 && current; depth++) {
    const message = current instanceof Error
      ? current.message
      : String(current)

    if (message.includes(UNIQUE_VIOLATION_MARKER)) {
      return true
    }

    current = (current as { cause?: unknown }).cause
  }

  return false
}

function memoryExtractionScope(userId: number, projectId: string | null) {
  return and(
    eq(schema.memoryEntries.userId, userId),
    projectId
      ? eq(schema.memoryEntries.projectId, projectId)
      : isNull(schema.memoryEntries.projectId),
  )
}

function memoryExtractionMergeSourceChatIds(
  existing: string[],
  chatId: string | null,
): string[] {
  if (chatId === null) {
    return existing
  }

  const merged = [...new Set([...existing, chatId])]

  return merged.slice(-MEMORY_LIMITS.maxSourceChatIds)
}

function memoryExtractionBodyLines(body: string): string[] {
  return body
    .split(BODY_LINE_SEPARATOR_PATTERN)
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '')
}

function memoryExtractionBodyLineKey(line: string): string {
  return memoryExtractionNormalizeText(line)
    .replace(BODY_BULLET_PREFIX_PATTERN, '')
    .replace(BODY_LINE_TRAILING_PUNCTUATION_PATTERN, '')
    .trim()
}

function memoryExtractionBodyByteCap(category: MemoryCategory): number {
  const isAlwaysInjected = (alwaysInjectedMemoryCategories as readonly string[])
    .includes(category)

  return isAlwaysInjected
    ? MEMORY_LIMITS.maxAlwaysInjectedBodyBytes
    : MEMORY_LIMITS.maxBodyBytes
}

function memoryExtractionAppendLines(
  existingBody: string,
  newBody: string,
): string[] {
  const knownKeys = new Set(
    memoryExtractionBodyLines(existingBody).map(memoryExtractionBodyLineKey),
  )
  const addedLines: string[] = []

  for (const line of memoryExtractionBodyLines(newBody)) {
    const key = memoryExtractionBodyLineKey(line)

    if (!key || knownKeys.has(key)) {
      continue
    }

    knownKeys.add(key)
    addedLines.push(line)
  }

  return addedLines
}

function memoryExtractionLinks(text: string): string[] {
  const links = new Set<string>()

  for (const pattern of LINK_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      links.add(memoryExtractionNormalizeText(
        match[0].replace(LINK_TRAILING_PUNCTUATION_PATTERN, ''),
      ))
    }
  }

  return [...links]
}

class MemoryExtractionApplier {
  private readonly input: MemoryExtractionApplyInput
  private readonly entriesByKey = new Map<string, MemoryExtractionIndexEntry>()
  private readonly groundingTexts: string[]
  private readonly createGroundingTexts: string[]
  private readonly groundingSources: MemoryExtractionGroundingText[]
  private readonly createGroundingSources: MemoryExtractionGroundingText[]
  private readonly result: MemoryExtractionApplyResult
  private readonly createdOrigin: Extract<MemoryOrigin, 'extraction' | 'import'>
  private readonly mutableOrigins: MemoryOrigin[]
  private readonly detectedCategories = new Set<MemorySensitiveCategory>()
  private readonly jevVerdicts = new Map<MemoryExtractionOp, MemoryJevVerdict>()
  private isSourceChatGone = false

  constructor(input: MemoryExtractionApplyInput) {
    this.input = input
    this.createdOrigin = input.origin ?? 'extraction'
    this.mutableOrigins = this.createdOrigin === 'import'
      ? ['import']
      : [...MEMORY_EXTRACTION_EDITABLE_ORIGINS]
    for (const entry of input.entries) {
      this.entriesByKey.set(
        memoryExtractionEntryKey(entry.category, entry.slug),
        { ...entry },
      )
    }

    this.groundingSources = input.groundingTexts.map(
      prepareMemoryExtractionGroundingText,
    )
    this.createGroundingSources = [
      ...this.groundingSources,
      ...(input.createGroundingTexts ?? []).map(
        prepareMemoryExtractionGroundingText,
      ),
    ]
    this.groundingTexts = this.groundingSources.map(source => source.collapsed)
    this.createGroundingTexts = this.createGroundingSources.map((source) => {
      return source.collapsed
    })
    this.result = {
      proposed: input.ops.length,
      created: 0,
      updated: 0,
      appended: 0,
      deleted: 0,
      dropped: {},
      blocked: {},
    }
  }

  async run(): Promise<MemoryExtractionApplyResult> {
    await this.runJevCheck()

    for (const [index, op] of this.input.ops.entries()) {
      if (index >= this.input.maxOps) {
        this.drop('over-limit')

        continue
      }

      await this.applyOp(op)
    }

    this.recordDetectedCategories()

    return this.result
  }

  private isJevCandidate(op: MemoryExtractionOp): boolean {
    if (op.op === 'delete' || op.neverStore !== null) {
      return false
    }

    const evidenceSources = op.op === 'create'
      ? this.createGroundingSources
      : this.groundingSources

    return isMemoryExtractionEvidenceGrounded(
      op.evidence,
      evidenceSources,
      this.groundingSavedText(op),
    )
  }

  private async runJevCheck() {
    if (!this.input.jev) {
      return
    }

    const ops = this.input.ops
      .slice(0, this.input.maxOps)
      .filter(op => this.isJevCandidate(op))

    if (ops.length === 0) {
      return
    }

    const verdicts = await this.input.jev.check(ops.map((op) => {
      return {
        title: op.title ?? '',
        description: op.description ?? '',
        body: op.body ?? '',
        source: buildMemoryJevGroundingExcerpt(
          op.evidence,
          op.op === 'create' ? this.createGroundingTexts : this.groundingTexts,
        ),
      }
    }))

    for (const [index, op] of ops.entries()) {
      const verdict = verdicts[index]

      if (verdict) {
        this.jevVerdicts.set(op, verdict)
      }
    }
  }

  private jevOutcome(op: MemoryExtractionOp): DropOutcome | null {
    const verdict = this.jevVerdicts.get(op)

    if (!verdict || verdict.kind === 'clear') {
      return null
    }

    return {
      dropped: verdict.kind === 'ungrounded'
        ? JEV_UNGROUNDED_DROP_REASON
        : JEV_SENSITIVE_DROP_REASON,
    }
  }

  private recordDetectedCategories() {
    if (!this.input.logger) {
      return
    }

    recordSensitiveDetection(
      [...this.detectedCategories],
      this.input.logger,
      COMPLIANCE_ORIGIN,
    )
  }

  private collectDetectedCategories(categories: MemorySensitiveCategory[]) {
    for (const category of categories) {
      this.detectedCategories.add(category)
    }
  }

  private drop(reason: string) {
    this.result.dropped[reason] = (this.result.dropped[reason] ?? 0) + 1
  }

  private isEditableEntry(entry: MemoryExtractionIndexEntry): boolean {
    return this.mutableOrigins.includes(entry.origin)
      && entry.sensitivity !== 'special'
  }

  private groundingSavedText(op: MemoryExtractionOp): string {
    const opText = [op.title, op.description, op.body]
      .filter(Boolean)
      .join('\n')
    const target = op.slug
      ? this.entriesByKey.get(memoryExtractionEntryKey(op.category, op.slug))
      : undefined

    if (op.op === 'delete') {
      return target
        ? [target.title, target.description, target.body].join('\n')
        : ''
    }

    if (!target || (op.op !== 'append' && op.op !== 'update')) {
      return opText
    }

    const newBody = op.body ?? ''

    if (op.op === 'append') {
      return memoryExtractionAppendLines(target.body, newBody).join('\n')
        || opText
    }

    const changedFields = [
      op.title !== null && op.title !== target.title ? op.title : null,
      op.description !== null && op.description !== target.description
        ? op.description
        : null,
    ]
    const changedBodyLines = op.body === null
      ? []
      : [
        ...memoryExtractionAppendLines(target.body, newBody),
        ...memoryExtractionAppendLines(newBody, target.body),
      ]

    return [...changedFields, ...changedBodyLines]
      .filter(Boolean)
      .join('\n')
      || [target.title, target.description, target.body].join('\n')
  }

  private hasUngroundedLinks(
    values: PersistedEntryValues,
    groundingTexts: string[],
    knownText = '',
  ): boolean {
    const links = memoryExtractionLinks(
      [values.title, values.description, values.body].join('\n'),
    )
    const knownLinks = new Set(memoryExtractionLinks(knownText))

    return links.some((link) => {
      return !knownLinks.has(link)
        && !groundingTexts.some(text => text.includes(link))
    })
  }

  private async applyOp(op: MemoryExtractionOp) {
    if (this.isSourceChatGone) {
      this.drop(CHAT_UNAVAILABLE_DROP_REASON)

      return
    }

    if (op.op !== 'create' && 'dropped' in this.findOpTarget(op)) {
      this.drop('unknown-target')

      return
    }

    if (op.op === 'append' && !op.body?.trim()) {
      this.drop('invalid')

      return
    }

    const evidenceSources = op.op === 'create'
      ? this.createGroundingSources
      : this.groundingSources

    if (!isMemoryExtractionEvidenceGrounded(
      op.evidence,
      evidenceSources,
      this.groundingSavedText(op),
    )) {
      this.drop('ungrounded')

      return
    }

    try {
      const outcome = await this.dispatchOp(op)

      if (outcome) {
        this.drop(outcome.dropped)
      }
    } catch (exception) {
      if (!memoryExtractionIsUniqueViolation(exception)) {
        throw exception
      }

      this.drop('conflict')
    }
  }

  private async dispatchOp(op: MemoryExtractionOp) {
    switch (op.op) {
      case 'create':
        return await this.applyCreate(op)
      case 'update':
        return await this.applyUpdate(op)
      case 'append':
        return await this.applyAppend(op)
      case 'delete':
        return await this.applyDelete(op)
    }
  }

  private evaluate(
    values: PersistedEntryValues,
    op: MemoryExtractionOp,
  ): DropOutcome | null {
    const verdict = evaluateMemoryEntry({
      title: values.title,
      description: values.description,
      body: values.body,
      sensitivity: 'none',
      extractorNeverStoreKind: op.neverStore,
    })

    if (verdict.allowed) {
      return this.jevOutcome(op)
    }

    if (verdict.reason === 'never-store') {
      for (const kind of verdict.kinds) {
        this.result.blocked[kind] = (this.result.blocked[kind] ?? 0) + 1
      }

      return { dropped: 'never-store' }
    }

    this.collectDetectedCategories(verdict.detectedCategories)

    return { dropped: SENSITIVE_TOPIC_DROP_REASON }
  }

  private async applyCreate(
    op: MemoryExtractionOp,
  ): Promise<DropOutcome | null> {
    const parsed = memoryEntryInputSchema.safeParse({
      category: op.category,
      title: op.title ?? '',
      description: op.description ?? '',
      body: op.body?.trim() ?? '',
      sensitivity: 'none',
      sensitiveCategory: null,
    })

    if (!parsed.success) {
      return { dropped: 'invalid' }
    }

    const slug = memoryExtractionSlugFromTitle(parsed.data.title)
    const existing = this.entriesByKey.get(
      memoryExtractionEntryKey(parsed.data.category, slug),
    )

    if (existing) {
      if (!this.isEditableEntry(existing)) {
        return { dropped: 'duplicate' }
      }

      return await this.mergeIntoExisting(existing, op, (base) => {
        const appendedBody = this.appendBody(base, parsed.data.body)

        if ('dropped' in appendedBody) {
          return appendedBody
        }

        return {
          title: parsed.data.title,
          description: parsed.data.description,
          body: appendedBody.body,
        }
      }, 'updated', true)
    }

    const values: PersistedEntryValues = {
      category: parsed.data.category,
      title: parsed.data.title,
      description: parsed.data.description,
      body: parsed.data.body,
      sensitivity: 'none',
      sensitiveCategory: null,
    }

    if (this.hasUngroundedLinks(values, this.createGroundingTexts)) {
      return { dropped: 'ungrounded' }
    }

    const blockedOutcome = this.evaluate(values, op)

    if (blockedOutcome) {
      return blockedOutcome
    }

    const cap = this.input.projectId
      ? MEMORY_LIMITS.maxProjectEntries
      : MEMORY_LIMITS.maxAccountEntries

    if (this.entriesByKey.size >= cap) {
      return { dropped: 'cap-reached' }
    }

    const sourceChatIds = this.input.chatId ? [this.input.chatId] : []
    const written = await insertGuardedMemoryEntry(this.input.db, {
      userId: this.input.userId,
      decodedProjectId: this.input.projectId
        ? decodePublicId(this.input.projectId)
        : null,
      category: values.category,
      slug,
      title: values.title,
      description: values.description,
      body: values.body,
      origin: this.createdOrigin,
      sourceChatIds,
      sourceMessageId: null,
      requiredChatId: this.input.chatId
        ? decodePublicId(this.input.chatId)
        : null,
    })

    if (!written) {
      return await this.refusedWriteOutcome({ dropped: 'cap-reached' })
    }

    this.entriesByKey.set(memoryExtractionEntryKey(values.category, slug), {
      id: written.id,
      ...values,
      slug,
      origin: this.createdOrigin,
      sourceChatIds,
      updatedAt: written.updatedAt,
      bodyHidden: false,
    })
    this.result.created += 1

    return null
  }

  private async applyUpdate(
    op: MemoryExtractionOp,
  ): Promise<DropOutcome | null> {
    const target = this.findEditableTarget(op)

    if ('dropped' in target) {
      return target
    }

    if (target.bodyHidden) {
      return { dropped: 'hidden-body' }
    }

    const patchFields: MemoryExtractionPatchFields = {}

    if (op.title !== null) {
      patchFields.title = op.title
    }

    if (op.description !== null) {
      patchFields.description = op.description
    }

    if (op.body !== null) {
      patchFields.body = op.body.trim()
    }

    return await this.mergeIntoExisting(
      target,
      op,
      () => patchFields,
      'updated',
      false,
    )
  }

  private appendBody(
    base: MemoryExtractionIndexEntry,
    newBody: string,
  ): { body: string } | DropOutcome {
    const addedLines = memoryExtractionAppendLines(base.body, newBody)

    if (!addedLines.length) {
      return { body: base.body }
    }

    const byteCap = memoryExtractionBodyByteCap(base.category)
    let body = base.body.trimEnd()
    let fittedLines = 0

    for (const line of addedLines) {
      const candidate = body ? `${body}${BODY_LINE_JOINER}${line}` : line

      if (memoryByteLength(candidate) > byteCap) {
        break
      }

      body = candidate
      fittedLines += 1
    }

    if (!fittedLines) {
      return { dropped: 'cap-reached' }
    }

    return { body }
  }

  private async applyAppend(
    op: MemoryExtractionOp,
  ): Promise<DropOutcome | null> {
    const target = this.findEditableTarget(op)

    if ('dropped' in target) {
      return target
    }

    const newBody = op.body?.trim() ?? ''

    if (!newBody) {
      return { dropped: 'invalid' }
    }

    return await this.mergeIntoExisting(target, op, (base) => {
      const appendedBody = this.appendBody(base, newBody)

      if ('dropped' in appendedBody) {
        return appendedBody
      }

      return { body: appendedBody.body }
    }, 'appended', true)
  }

  private findOpTarget(
    op: MemoryExtractionOp,
  ): MemoryExtractionIndexEntry | DropOutcome {
    const target = op.slug
      ? this.entriesByKey.get(memoryExtractionEntryKey(op.category, op.slug))
      : undefined

    return target ?? { dropped: 'unknown-target' }
  }

  private findEditableTarget(
    op: MemoryExtractionOp,
  ): MemoryExtractionIndexEntry | DropOutcome {
    const target = this.findOpTarget(op)

    if ('dropped' in target) {
      return target
    }

    if (!this.isEditableEntry(target)) {
      return { dropped: 'locked' }
    }

    return target
  }

  private forgetEntry(entry: MemoryExtractionIndexEntry) {
    this.entriesByKey.delete(
      memoryExtractionEntryKey(entry.category, entry.slug),
    )
  }

  private async readFreshEntry(
    entry: MemoryExtractionIndexEntry,
  ): Promise<MemoryExtractionIndexEntry | null> {
    const rows = await this.input.db
      .select()
      .from(schema.memoryEntries)
      .where(and(
        eq(schema.memoryEntries.id, entry.id),
        memoryExtractionScope(this.input.userId, this.input.projectId),
      ))
      .limit(1)
    const row = rows[0]

    if (!row) {
      return null
    }

    return {
      id: row.id,
      category: row.category,
      slug: row.slug,
      title: row.title,
      description: row.description,
      body: row.body,
      sensitivity: row.sensitivity,
      sensitiveCategory: row.sensitiveCategory,
      origin: row.origin,
      sourceChatIds: row.sourceChatIds,
      updatedAt: row.updatedAt,
      bodyHidden: false,
    }
  }

  /**
   * The atomic "the source chat still exists and is not excluded from
   * memory" condition every write that records the chat as a source
   * carries, or none for a pass without a chat (an import). A chat deleted
   * or excluded after the pass re-read it then makes the write land on
   * nothing instead of citing it.
   */
  private sourceChatGuard() {
    if (this.input.chatId === null) {
      return undefined
    }

    return sql`exists (
      select 1 from ${schema.chats}
      where ${eq(schema.chats.id, this.input.chatId)}
        and ${eq(schema.chats.userId, this.input.userId)}
        and ${chatIsMemoryIncluded()}
    )`
  }

  private async readIsSourceChatGone(): Promise<boolean> {
    if (this.input.chatId === null) {
      return false
    }

    const rows = await this.input.db
      .select({ id: schema.chats.id })
      .from(schema.chats)
      .where(and(
        eq(schema.chats.id, this.input.chatId),
        eq(schema.chats.userId, this.input.userId),
        chatIsMemoryIncluded(),
      ))
      .limit(1)

    return rows.length === 0
  }

  private async refusedWriteOutcome<T>(
    fallback: T,
  ): Promise<T | DropOutcome> {
    if (!(await this.readIsSourceChatGone())) {
      return fallback
    }

    this.isSourceChatGone = true

    return { dropped: CHAT_UNAVAILABLE_DROP_REASON }
  }

  private unchangedRowGuard(base: MemoryExtractionIndexEntry) {
    return and(
      eq(schema.memoryEntries.id, base.id),
      memoryExtractionScope(this.input.userId, this.input.projectId),
      inArray(schema.memoryEntries.origin, this.mutableOrigins),
      eq(schema.memoryEntries.sensitivity, 'none'),
      eq(schema.memoryEntries.updatedAt, base.updatedAt),
      eq(schema.memoryEntries.body, base.body),
    )
  }

  /**
   * Writes a merge as a compare-and-set on the version of the row that was
   * read: it only lands while the row still has the same origin, sensitivity,
   * `updated_at` and body, so a user edit made during the model call is never
   * overwritten. A write that finds the row changed is retried once from a
   * fresh read when `rereadsBase` is set (append and same-topic create, whose
   * new lines are recomputed against the fresh body); an update is a full
   * rewrite of what the model saw and is dropped as `conflict` instead.
   */
  private async mergeIntoExisting(
    target: MemoryExtractionIndexEntry,
    op: MemoryExtractionOp,
    buildFields: MergeFieldsBuilder,
    counter: MergeCounter,
    rereadsBase: boolean,
  ): Promise<DropOutcome | null> {
    const attempts = rereadsBase ? 2 : 1
    let base = target

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (rereadsBase) {
        const fresh = await this.readFreshEntry(target)

        if (!fresh) {
          this.forgetEntry(target)

          return { dropped: 'unknown-target' }
        }

        base = fresh
      }

      if (!this.isEditableEntry(base)) {
        return { dropped: 'locked' }
      }

      const fields = buildFields(base)

      if ('dropped' in fields) {
        return fields
      }

      const outcome = await this.writeMerge(base, op, fields, counter)

      if (outcome !== STALE_ROW) {
        return outcome
      }
    }

    if (!(await this.readFreshEntry(target))) {
      this.forgetEntry(target)

      return { dropped: 'unknown-target' }
    }

    return { dropped: 'conflict' }
  }

  private async writeMerge(
    base: MemoryExtractionIndexEntry,
    op: MemoryExtractionOp,
    patchFields: MemoryExtractionPatchFields,
    counter: MergeCounter,
  ): Promise<DropOutcome | null | typeof STALE_ROW> {
    const patch = memoryEntryPatchSchema.safeParse(patchFields)

    if (!patch.success) {
      return { dropped: 'invalid' }
    }

    const merged = memoryEntryInputSchema.safeParse({
      category: base.category,
      title: patch.data.title ?? base.title,
      description: patch.data.description ?? base.description,
      body: patch.data.body ?? base.body,
      sensitivity: 'none',
      sensitiveCategory: null,
    })

    if (!merged.success) {
      return { dropped: 'invalid' }
    }

    const values: PersistedEntryValues = {
      category: base.category,
      title: merged.data.title,
      description: merged.data.description,
      body: merged.data.body,
      sensitivity: 'none',
      sensitiveCategory: null,
    }

    if (
      values.title === base.title
      && values.description === base.description
      && values.body === base.body
    ) {
      return await this.addSourceChat(base)
    }

    const knownText = [base.title, base.description, base.body].join('\n')

    if (this.hasUngroundedLinks(values, this.groundingTexts, knownText)) {
      return { dropped: 'ungrounded' }
    }

    const blockedOutcome = this.evaluate(values, op)

    if (blockedOutcome) {
      return blockedOutcome
    }

    const sourceChatIds = memoryExtractionMergeSourceChatIds(
      base.sourceChatIds,
      this.input.chatId,
    )
    const rows = await this.input.db
      .update(schema.memoryEntries)
      .set({
        title: values.title,
        description: values.description,
        body: values.body,
        sourceChatIds,
      })
      .where(and(this.unchangedRowGuard(base), this.sourceChatGuard()))
      .returning({ updatedAt: schema.memoryEntries.updatedAt })

    if (!rows.length) {
      return await this.refusedWriteOutcome(STALE_ROW)
    }

    this.entriesByKey.set(
      memoryExtractionEntryKey(base.category, base.slug),
      { ...base, ...values, sourceChatIds, updatedAt: rows[0]!.updatedAt },
    )
    this.result[counter] += 1

    return null
  }

  private async addSourceChat(
    base: MemoryExtractionIndexEntry,
  ): Promise<DropOutcome | null | typeof STALE_ROW> {
    if (
      this.input.chatId === null
      || base.sourceChatIds.includes(this.input.chatId)
    ) {
      return { dropped: 'unchanged' }
    }

    const sourceChatIds = memoryExtractionMergeSourceChatIds(
      base.sourceChatIds,
      this.input.chatId,
    )
    const rows = await this.input.db
      .update(schema.memoryEntries)
      .set({ sourceChatIds })
      .where(and(this.unchangedRowGuard(base), this.sourceChatGuard()))
      .returning({ updatedAt: schema.memoryEntries.updatedAt })

    if (!rows.length) {
      return await this.refusedWriteOutcome(STALE_ROW)
    }

    this.entriesByKey.set(
      memoryExtractionEntryKey(base.category, base.slug),
      { ...base, sourceChatIds, updatedAt: rows[0]!.updatedAt },
    )
    this.result.updated += 1

    return null
  }

  private async applyDelete(
    op: MemoryExtractionOp,
  ): Promise<DropOutcome | null> {
    const target = this.findEditableTarget(op)

    if ('dropped' in target) {
      return target
    }

    const rows = await this.input.db
      .delete(schema.memoryEntries)
      .where(this.unchangedRowGuard(target))
      .returning({ id: schema.memoryEntries.id })

    if (!rows.length) {
      if (!(await this.readFreshEntry(target))) {
        this.forgetEntry(target)

        return { dropped: 'unknown-target' }
      }

      return { dropped: 'conflict' }
    }

    this.forgetEntry(target)
    this.result.deleted += 1

    return null
  }
}

/**
 * Applies the extractor's ops sequentially. Each op is independent: it must
 * quote the user's own words and share a content word with the text it would
 * save (for an update or append only the changed lines count), pass schema
 * validation on the exact persisted row, pass the compliance gate (text the
 * server classifier flags as special-category data is dropped as
 * `sensitive-topic`), and only ever touch a non-special row of this user and
 * scope whose origin the pass may change: `extraction` and `import` for a chat
 * pass, `import` only for an import pass (rows learned from chats are locked
 * to pasted text). A created row gets the input `origin`; an updated row keeps
 * its own. `append` adds the body lines that are not stored yet, in order, as
 * many whole lines as fit the category's byte cap (`cap-reached` only when none
 * fits); `update` is a full rewrite and needs a visible body; a `create` that
 * collides with a mutable entry is merged as an append of its new lines. Every
 * write is a compare-and-set on the version read (origin, sensitivity,
 * `updated_at` and body): an append and a colliding create re-read the row and
 * retry once, an update or delete that finds the row changed is dropped as
 * `conflict`, so a user edit made during the model call is never overwritten.
 * Extraction never writes a special-category entry: every row it persists has
 * `sensitivity: 'none'`. Detected category ids (never the text) are logged
 * once per run. With a `jev` checker, the ops that pass the evidence check
 * and carry no extractor never-store flag are sent to TypeSafe AI Jev in one
 * batched call before any write, each with a short excerpt around its
 * evidence; an op the gate allowed but Jev flags is dropped as
 * `extra-check-sensitive` or `extra-check-ungrounded`. Returns counts only.
 */
export async function applyMemoryExtractionOps(
  input: MemoryExtractionApplyInput,
): Promise<MemoryExtractionApplyResult> {
  return await new MemoryExtractionApplier(input).run()
}
