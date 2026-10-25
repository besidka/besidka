import type {
  ComplianceBlockedCounts,
  MemoryCategory,
  MemorySensitiveCategory,
  MemorySensitivity,
} from '#shared/types/memory.d'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import {
  memoryEntryInputSchema,
  memoryEntryPatchSchema,
} from '#shared/utils/memory-schemas'
import { and, eq, isNull, notExists } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { evaluateMemoryEntry } from '~~/server/utils/memory/compliance'
import type { MemoryExtractionOp } from '~~/server/utils/memory/extract-schema'
import { MEMORY_EXTRACTION_LIMITS } from '~~/server/utils/memory/extract-limits'
import {
  memoryExtractionNormalizeText,
} from '~~/server/utils/memory/extract-input'
import type {
  MemoryExtractionIndexEntry,
} from '~~/server/utils/memory/extract-input'

type DbClient = ReturnType<typeof useDb>

const FALLBACK_SLUG_PREFIX = 'entry'
const UNIQUE_VIOLATION_MARKER = 'UNIQUE constraint'
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
  chatId: string
  includeSensitive: boolean
  entries: MemoryExtractionIndexEntry[]
  groundingTexts: string[]
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
  sensitivity?: MemorySensitivity
  sensitiveCategory?: MemorySensitiveCategory
}

interface PersistedEntryValues {
  category: MemoryCategory
  title: string
  description: string
  body: string
  sensitivity: MemorySensitivity
  sensitiveCategory: MemorySensitiveCategory | null
}

interface DropOutcome {
  dropped: string
}

interface GuardedWriteOutcome {
  id: string | null
  purged: boolean
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
  chatId: string,
): string[] {
  const merged = [...new Set([...existing, chatId])]

  return merged.slice(-MEMORY_LIMITS.maxSourceChatIds)
}

function memoryExtractionSpecialGuard(
  db: DbClient,
  input: MemoryExtractionApplyInput,
  category: MemoryCategory,
  slug: string,
) {
  const optedIn = db
    .select({ id: schema.userSettings.id })
    .from(schema.userSettings)
    .where(and(
      eq(schema.userSettings.userId, input.userId),
      eq(schema.userSettings.memoryIncludeSensitive, true),
    ))

  return db
    .delete(schema.memoryEntries)
    .where(and(
      memoryExtractionScope(input.userId, input.projectId),
      eq(schema.memoryEntries.category, category),
      eq(schema.memoryEntries.slug, slug),
      eq(schema.memoryEntries.sensitivity, 'special'),
      notExists(optedIn),
    ))
    .returning({ id: schema.memoryEntries.id })
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
  private readonly result: MemoryExtractionApplyResult

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

    return this.result
  }

  private drop(reason: string) {
    this.result.dropped[reason] = (this.result.dropped[reason] ?? 0) + 1
  }

  private isGrounded(evidence: string): boolean {
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

    return this.groundingTexts.some(text => text.includes(needle))
  }

  private hasUngroundedLinks(
    values: PersistedEntryValues,
    knownText = '',
  ): boolean {
    const links = memoryExtractionLinks(
      [values.title, values.description, values.body].join('\n'),
    )
    const knownLinks = new Set(memoryExtractionLinks(knownText))

    return links.some((link) => {
      return !knownLinks.has(link)
        && !this.groundingTexts.some(text => text.includes(link))
    })
  }

  private async applyOp(op: MemoryExtractionOp) {
    if (!this.isGrounded(op.evidence)) {
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
      sensitivity: values.sensitivity,
      extractorNeverStoreKind: op.neverStore,
      includeSensitive: this.input.includeSensitive,
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

    return { dropped: 'sensitive-disabled' }
  }

  private async applyCreate(
    op: MemoryExtractionOp,
  ): Promise<DropOutcome | null> {
    const isSpecial = op.sensitivity === 'special'
      || op.sensitiveCategory !== null
    const parsed = memoryEntryInputSchema.safeParse({
      category: op.category,
      title: op.title ?? '',
      description: op.description ?? '',
      body: op.body?.trim() ?? '',
      sensitivity: isSpecial ? 'special' : (op.sensitivity ?? 'none'),
      sensitiveCategory: op.sensitiveCategory,
    })

    if (!parsed.success) {
      return { dropped: 'invalid' }
    }

    const slug = memoryExtractionSlugFromTitle(parsed.data.title)
    const existing = this.entriesByKey.get(
      memoryExtractionEntryKey(parsed.data.category, slug),
    )

    if (existing) {
      if (existing.origin !== 'extraction') {
        return { dropped: 'duplicate' }
      }

      return await this.mergeIntoExisting(existing, op, {
        title: parsed.data.title,
        description: parsed.data.description,
        body: parsed.data.body,
        sensitivity: parsed.data.sensitivity,
        sensitiveCategory: parsed.data.sensitiveCategory ?? undefined,
      })
    }

    const values: PersistedEntryValues = {
      category: parsed.data.category,
      title: parsed.data.title,
      description: parsed.data.description,
      body: parsed.data.body,
      sensitivity: parsed.data.sensitivity ?? 'none',
      sensitiveCategory: parsed.data.sensitiveCategory ?? null,
    }

    if (this.hasUngroundedLinks(values)) {
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

    const sourceChatIds = [this.input.chatId]
    const insert = this.input.db
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
    const written = await this.writeGuarded(
      insert,
      values.sensitivity,
      values.category,
      slug,
    )

    if (written.purged || !written.id) {
      return { dropped: 'sensitive-disabled' }
    }

    this.entriesByKey.set(memoryExtractionEntryKey(values.category, slug), {
      id: written.id,
      ...values,
      slug,
      origin: 'extraction',
      sourceChatIds,
      bodyHidden: false,
    })
    this.result.created += 1

    return null
  }

  private async writeGuarded(
    statement: PromiseLike<Array<{ id: string }>>,
    sensitivity: MemorySensitivity,
    category: MemoryCategory,
    slug: string,
  ): Promise<GuardedWriteOutcome> {
    if (sensitivity !== 'special') {
      const rows = await statement

      return { id: rows[0]?.id ?? null, purged: false }
    }

    const guard = memoryExtractionSpecialGuard(
      this.input.db,
      this.input,
      category,
      slug,
    )
    const [written, purged] = await this.input.db.batch(
      [statement, guard] as unknown as Parameters<DbClient['batch']>[0],
    ) as unknown as [Array<{ id: string }>, Array<{ id: string }>]

    return { id: written[0]?.id ?? null, purged: purged.length > 0 }
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

    if (op.sensitivity !== null) {
      patchFields.sensitivity = op.sensitivity
    }

    if (op.sensitiveCategory !== null) {
      patchFields.sensitiveCategory = op.sensitiveCategory
      patchFields.sensitivity = 'special'
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

    if (target.origin !== 'extraction') {
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

    const sensitivity: MemorySensitivity = target.sensitivity === 'special'
      ? 'special'
      : (patch.data.sensitivity ?? target.sensitivity)
    const sensitiveCategory = sensitivity === 'special'
      ? (patch.data.sensitiveCategory ?? target.sensitiveCategory)
      : null
    const merged = memoryEntryInputSchema.safeParse({
      category: target.category,
      title: patch.data.title ?? target.title,
      description: patch.data.description ?? target.description,
      body: patch.data.body ?? target.body,
      sensitivity,
      sensitiveCategory,
    })

    if (!merged.success) {
      return { dropped: 'invalid' }
    }

    const values: PersistedEntryValues = {
      category: target.category,
      title: merged.data.title,
      description: merged.data.description,
      body: merged.data.body,
      sensitivity,
      sensitiveCategory: merged.data.sensitiveCategory ?? null,
    }

    if (
      values.title === target.title
      && values.description === target.description
      && values.body === target.body
      && values.sensitivity === target.sensitivity
      && values.sensitiveCategory === target.sensitiveCategory
    ) {
      return await this.addSourceChat(target)
    }

    const knownText = [target.title, target.description, target.body].join('\n')

    if (this.hasUngroundedLinks(values, knownText)) {
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
    const update = this.input.db
      .update(schema.memoryEntries)
      .set({
        title: values.title,
        description: values.description,
        body: values.body,
        sensitivity: values.sensitivity,
        sensitiveCategory: values.sensitiveCategory,
        sourceChatIds,
      })
      .where(and(
        eq(schema.memoryEntries.id, target.id),
        memoryExtractionScope(this.input.userId, this.input.projectId),
      ))
      .returning({ id: schema.memoryEntries.id })
    const written = await this.writeGuarded(
      update,
      values.sensitivity,
      target.category,
      target.slug,
    )

    if (written.purged || !written.id) {
      this.entriesByKey.delete(
        memoryExtractionEntryKey(target.category, target.slug),
      )

      return {
        dropped: written.purged ? 'sensitive-disabled' : 'unknown-target',
      }
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
    if (target.sourceChatIds.includes(this.input.chatId)) {
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
 * compliance gate, and only ever touch an `extraction`-origin row of this
 * user and scope. A special-category write is batched with a delete that
 * removes the row again when the user is not opted in, so an opt-out purge
 * racing the pass cannot leave one behind. Returns counts only.
 */
export async function applyMemoryExtractionOps(
  input: MemoryExtractionApplyInput,
): Promise<MemoryExtractionApplyResult> {
  return await new MemoryExtractionApplier(input).run()
}
