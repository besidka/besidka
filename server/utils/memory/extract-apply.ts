import type {
  ComplianceBlockedCounts,
  MemoryCategory,
  MemorySensitiveCategory,
} from '#shared/types/memory.d'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import {
  memoryEntryInputSchema,
  memoryEntryPatchSchema,
} from '#shared/utils/memory-schemas'
import { and, eq, isNull } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  evaluateMemoryEntry,
  recordSensitiveDetection,
} from '~~/server/utils/memory/compliance'
import type { ComplianceLogger } from '~~/server/utils/memory/compliance'
import type { MemoryExtractionOp } from '~~/server/utils/memory/extract-schema'
import { MEMORY_EXTRACTION_LIMITS } from '~~/server/utils/memory/extract-limits'
import {
  memoryExtractionNormalizeText,
} from '~~/server/utils/memory/extract-input'
import type {
  MemoryExtractionIndexEntry,
} from '~~/server/utils/memory/extract-input'

type DbClient = ReturnType<typeof useDb>

const COMPLIANCE_ORIGIN = 'memory-extraction'
const FALLBACK_SLUG_PREFIX = 'entry'
const UNIQUE_VIOLATION_MARKER = 'UNIQUE constraint'
const SENSITIVE_TOPIC_DROP_REASON = 'sensitive-topic'
const HASH_MULTIPLIER = 31
const HASH_RADIX = 36
const SLUG_SEPARATOR_PATTERN = /[^a-z0-9]+/gu
const SLUG_EDGE_PATTERN = /^-+|-+$/gu
const COMBINING_MARKS_PATTERN = /\p{M}/gu
const WORD_SEPARATOR_PATTERN = /\s+/u
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
  logger?: ComplianceLogger
}

export interface MemoryExtractionApplyResult {
  proposed: number
  created: number
  updated: number
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

function isEditableEntry(entry: MemoryExtractionIndexEntry): boolean {
  return entry.origin === 'extraction' && entry.sensitivity !== 'special'
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
  private readonly result: MemoryExtractionApplyResult
  private readonly detectedCategories = new Set<MemorySensitiveCategory>()

  constructor(input: MemoryExtractionApplyInput) {
    this.input = input
    for (const entry of input.entries) {
      this.entriesByKey.set(
        memoryExtractionEntryKey(entry.category, entry.slug),
        { ...entry },
      )
    }

    this.groundingTexts = input.groundingTexts.map(
      memoryExtractionNormalizeText,
    )
    this.createGroundingTexts = [
      ...this.groundingTexts,
      ...(input.createGroundingTexts ?? []).map(memoryExtractionNormalizeText),
    ]
    this.result = {
      proposed: input.ops.length,
      created: 0,
      updated: 0,
      deleted: 0,
      dropped: {},
      blocked: {},
    }
  }

  async run(): Promise<MemoryExtractionApplyResult> {
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

  private isGrounded(evidence: string, groundingTexts: string[]): boolean {
    const needle = memoryExtractionNormalizeText(evidence)

    const wordCount = needle
      .split(WORD_SEPARATOR_PATTERN)
      .filter(Boolean)
      .length

    if (
      needle.length < MEMORY_EXTRACTION_LIMITS.evidenceMinChars
      || wordCount < MEMORY_EXTRACTION_LIMITS.evidenceMinWords
    ) {
      return false
    }

    return groundingTexts.some(text => text.includes(needle))
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
    const evidenceTexts = op.op === 'create'
      ? this.createGroundingTexts
      : this.groundingTexts

    if (!this.isGrounded(op.evidence, evidenceTexts)) {
      this.drop('ungrounded')

      return
    }

    try {
      const outcome = op.op === 'create'
        ? await this.applyCreate(op)
        : op.op === 'update'
          ? await this.applyUpdate(op)
          : await this.applyDelete(op)

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
      return null
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
      if (!isEditableEntry(existing)) {
        return { dropped: 'duplicate' }
      }

      return await this.mergeIntoExisting(existing, op, {
        title: parsed.data.title,
        description: parsed.data.description,
        body: parsed.data.body,
      })
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
    const rows = await this.input.db
      .insert(schema.memoryEntries)
      .values({
        userId: this.input.userId,
        projectId: this.input.projectId ?? undefined,
        ...values,
        slug,
        origin: 'extraction',
        sourceChatIds,
      })
      .returning({ id: schema.memoryEntries.id })
    const writtenId = rows[0]?.id

    if (!writtenId) {
      return { dropped: 'unknown-target' }
    }

    this.entriesByKey.set(memoryExtractionEntryKey(values.category, slug), {
      id: writtenId,
      ...values,
      slug,
      origin: 'extraction',
      sourceChatIds,
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

    return await this.mergeIntoExisting(target, op, patchFields)
  }

  private findEditableTarget(
    op: MemoryExtractionOp,
  ): MemoryExtractionIndexEntry | DropOutcome {
    const target = op.slug
      ? this.entriesByKey.get(memoryExtractionEntryKey(op.category, op.slug))
      : undefined

    if (!target) {
      return { dropped: 'unknown-target' }
    }

    if (!isEditableEntry(target)) {
      return { dropped: 'locked' }
    }

    return target
  }

  private async mergeIntoExisting(
    target: MemoryExtractionIndexEntry,
    op: MemoryExtractionOp,
    patchFields: MemoryExtractionPatchFields,
  ): Promise<DropOutcome | null> {
    if (target.bodyHidden) {
      return { dropped: 'hidden-body' }
    }

    const patch = memoryEntryPatchSchema.safeParse(patchFields)

    if (!patch.success) {
      return { dropped: 'invalid' }
    }

    const merged = memoryEntryInputSchema.safeParse({
      category: target.category,
      title: patch.data.title ?? target.title,
      description: patch.data.description ?? target.description,
      body: patch.data.body ?? target.body,
      sensitivity: 'none',
      sensitiveCategory: null,
    })

    if (!merged.success) {
      return { dropped: 'invalid' }
    }

    const values: PersistedEntryValues = {
      category: target.category,
      title: merged.data.title,
      description: merged.data.description,
      body: merged.data.body,
      sensitivity: 'none',
      sensitiveCategory: null,
    }

    if (
      values.title === target.title
      && values.description === target.description
      && values.body === target.body
    ) {
      return await this.addSourceChat(target)
    }

    const knownText = [target.title, target.description, target.body].join('\n')

    if (this.hasUngroundedLinks(values, this.groundingTexts, knownText)) {
      return { dropped: 'ungrounded' }
    }

    const blockedOutcome = this.evaluate(values, op)

    if (blockedOutcome) {
      return blockedOutcome
    }

    const sourceChatIds = memoryExtractionMergeSourceChatIds(
      target.sourceChatIds,
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
      .where(and(
        eq(schema.memoryEntries.id, target.id),
        memoryExtractionScope(this.input.userId, this.input.projectId),
      ))
      .returning({ id: schema.memoryEntries.id })

    if (!rows.length) {
      this.entriesByKey.delete(
        memoryExtractionEntryKey(target.category, target.slug),
      )

      return { dropped: 'unknown-target' }
    }

    this.entriesByKey.set(
      memoryExtractionEntryKey(target.category, target.slug),
      { ...target, ...values, sourceChatIds },
    )
    this.result.updated += 1

    return null
  }

  private async addSourceChat(
    target: MemoryExtractionIndexEntry,
  ): Promise<DropOutcome | null> {
    if (
      this.input.chatId === null
      || target.sourceChatIds.includes(this.input.chatId)
    ) {
      return { dropped: 'unchanged' }
    }

    const sourceChatIds = memoryExtractionMergeSourceChatIds(
      target.sourceChatIds,
      this.input.chatId,
    )
    const rows = await this.input.db
      .update(schema.memoryEntries)
      .set({ sourceChatIds })
      .where(and(
        eq(schema.memoryEntries.id, target.id),
        memoryExtractionScope(this.input.userId, this.input.projectId),
      ))
      .returning({ id: schema.memoryEntries.id })

    if (!rows.length) {
      this.entriesByKey.delete(
        memoryExtractionEntryKey(target.category, target.slug),
      )

      return { dropped: 'unknown-target' }
    }

    this.entriesByKey.set(
      memoryExtractionEntryKey(target.category, target.slug),
      { ...target, sourceChatIds },
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
      .where(and(
        eq(schema.memoryEntries.id, target.id),
        memoryExtractionScope(this.input.userId, this.input.projectId),
        eq(schema.memoryEntries.origin, 'extraction'),
      ))
      .returning({ id: schema.memoryEntries.id })

    this.entriesByKey.delete(
      memoryExtractionEntryKey(target.category, target.slug),
    )

    if (!rows.length) {
      return { dropped: 'unknown-target' }
    }

    this.result.deleted += 1

    return null
  }
}

/**
 * Applies the extractor's ops sequentially. Each op is independent: it must
 * quote the user's own words (the code-level defence against text echoed by
 * the assistant), pass schema validation on the exact persisted row, pass the
 * compliance gate (text the server classifier flags as special-category data
 * is dropped as `sensitive-topic`), and only ever touch an
 * `extraction`-origin, non-special row of this user and scope. Extraction
 * never writes a special-category entry: every row it persists has
 * `sensitivity: 'none'`. Detected category ids (never the text) are logged
 * once per run. Returns counts only.
 */
export async function applyMemoryExtractionOps(
  input: MemoryExtractionApplyInput,
): Promise<MemoryExtractionApplyResult> {
  return await new MemoryExtractionApplier(input).run()
}
