import { createError } from 'evlog'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import type {
  ComplianceBlockedCounts,
  MemoryCategory,
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryPatch,
  MemoryOrigin,
  MemorySensitiveCategory,
  MemorySensitivity,
  NeverStoreKind,
} from '#shared/types/memory.d'
import type {
  MemoryEntryGroup,
  MemoryEntryLimits,
  MemoryExport,
} from '#shared/types/memory-api.d'
import {
  MEMORY_LIMITS,
  MEMORY_SETTING_DEFAULTS,
  alwaysInjectedMemoryCategories,
  memoryCategories,
  SENSITIVE_TOPIC_REFUSAL_MESSAGE,
  neverStoreKinds,
} from '#shared/utils/memory-policy'
import {
  memoryEntryInputSchema,
  memoryEntryPatchSchema,
} from '#shared/utils/memory-schemas'
import * as schema from '~~/server/db/schema'
import {
  decodePublicId,
  encodePublicId,
} from '~~/server/utils/custom-db-types'
import {
  evaluateMemoryEntry,
  recordBlockedCounts,
  recordSensitiveDetection,
} from '~~/server/utils/memory/compliance'
import {
  slugifyMemoryTitle,
  suffixMemorySlug,
} from '~~/server/utils/memory/entry-slug'

type DbClient = ReturnType<typeof useDb>

export type MemoryEntryRow = typeof schema.memoryEntries.$inferSelect

export type MemoryScopeFilter
  = | { kind: 'account' }
    | { kind: 'project', projectId: string }
    | { kind: 'all' }

export interface MemoryWriteLogger {
  set: (fields: Record<string, unknown>) => void
}

export interface MemoryWriteContext {
  db: DbClient
  userId: number
  logger?: MemoryWriteLogger
}

export interface CreateMemoryEntryOptions {
  input: MemoryEntryInput
  origin: MemoryOrigin
  sourceChatIds?: string[]
  sourceMessageId?: string | null
  complianceOrigin: string
}

export interface UpdateMemoryEntryOptions {
  id: string
  patch: MemoryEntryPatch
  origin?: MemoryOrigin
  sourceChatIds?: string[]
  sourceMessageId?: string | null
  complianceOrigin: string
}

const NOOP_LOGGER: MemoryWriteLogger = {
  set: () => {},
}

const SINGLETON_CATEGORIES: readonly string[] = alwaysInjectedMemoryCategories

const SLUG_RACE_RETRIES = 5

const MAX_ERROR_CAUSE_DEPTH = 5

export function toMemoryEntryWire(row: MemoryEntryRow): MemoryEntry {
  return {
    id: row.id,
    projectId: row.projectId,
    category: row.category,
    slug: row.slug,
    title: row.title,
    description: row.description,
    body: row.body,
    sensitivity: row.sensitivity,
    sensitiveCategory: row.sensitiveCategory,
    origin: row.origin,
    sourceChatIds: row.sourceChatIds,
    sourceMessageId: row.sourceMessageId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  }
}

export function getMemoryEntryLimits(): MemoryEntryLimits {
  return {
    maxAccountEntries: MEMORY_LIMITS.maxAccountEntries,
    maxProjectEntries: MEMORY_LIMITS.maxProjectEntries,
    maxBodyBytes: MEMORY_LIMITS.maxBodyBytes,
    maxAlwaysInjectedBodyBytes: MEMORY_LIMITS.maxAlwaysInjectedBodyBytes,
    maxDescriptionChars: MEMORY_LIMITS.maxDescriptionChars,
    maxTitleChars: MEMORY_LIMITS.maxTitleChars,
  }
}

export function groupMemoryEntries(
  entries: MemoryEntry[],
): MemoryEntryGroup[] {
  return memoryCategories.map((category) => {
    return {
      category,
      entries: entries.filter((entry) => {
        return entry.category === category
      }),
    }
  })
}

function isSingletonCategory(category: string): boolean {
  return SINGLETON_CATEGORIES.includes(category)
}

function isUniqueViolation(exception: unknown): boolean {
  let current: unknown = exception

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) {
      return false
    }

    if (current.message.includes('UNIQUE constraint failed')) {
      return true
    }

    current = current.cause
  }

  return false
}

function createNotFoundError(message: string) {
  return createError({
    message,
    status: 404,
  })
}

function createUniqueConflictError(category: MemoryCategory) {
  if (isSingletonCategory(category)) {
    return createError({
      message: `The ${category} entry already exists, edit it instead`,
      status: 409,
      why: `Only one ${category} entry is kept per scope.`,
      fix: `Edit the existing ${category} entry instead of creating another.`,
    })
  }

  return createError({
    message: 'An entry with this name already exists',
    status: 409,
    why: 'Another entry in this category already uses this name.',
    fix: 'Choose a different title or edit the existing entry.',
  })
}

function createSensitiveTopicError(
  detectedCategories: MemorySensitiveCategory[],
) {
  const why = detectedCategories.length > 0
    ? `This entry looks like sensitive data (${detectedCategories.join(', ')}).`
    : 'This entry is marked sensitive.'

  return createError({
    message: SENSITIVE_TOPIC_REFUSAL_MESSAGE,
    status: 422,
    why,
    fix: 'Remove the sensitive details and save again.',
  })
}

function createLimitError(isProjectScope: boolean) {
  const cap = isProjectScope
    ? MEMORY_LIMITS.maxProjectEntries
    : MEMORY_LIMITS.maxAccountEntries

  return createError({
    message: 'Memory limit reached',
    status: 409,
    why: `At most ${cap} entries fit in ${isProjectScope
      ? 'a project'
      : 'your account memory'}.`,
    fix: 'Delete or merge an existing entry first.',
  })
}

function assertEntryAllowed(
  verdict: ReturnType<typeof evaluateMemoryEntry>,
  logger: MemoryWriteLogger,
  complianceOrigin: string,
): void {
  if (verdict.allowed) {
    return
  }

  if (verdict.reason === 'sensitive-topic') {
    recordSensitiveDetection(
      verdict.detectedCategories,
      logger,
      complianceOrigin,
    )

    throw createSensitiveTopicError(verdict.detectedCategories)
  }

  const blocked: ComplianceBlockedCounts = {}

  for (const kind of verdict.kinds) {
    blocked[kind] = 1
  }

  recordBlockedCounts(blocked, logger, complianceOrigin)

  throw createError({
    message: 'This memory contains data that cannot be stored',
    status: 422,
    why: `Detected: ${describeNeverStoreKinds(verdict.kinds)}.`,
    fix: 'Remove the flagged data from the memory and save again.',
  })
}

function readDeclaredSensitivity(declared: {
  sensitivity?: MemorySensitivity
  sensitiveCategory?: MemorySensitiveCategory | null
}): MemorySensitivity {
  if (
    declared.sensitivity === 'special'
    || (declared.sensitiveCategory ?? null) !== null
  ) {
    return 'special'
  }

  return 'none'
}

function describeNeverStoreKinds(kinds: NeverStoreKind[]): string {
  return neverStoreKinds
    .filter((kind) => {
      return kinds.includes(kind.id)
    })
    .map((kind) => {
      return `${kind.label} (${kind.id})`
    })
    .join(', ')
}

function throwInvalidEntry(message: string): never {
  throw createError({
    message: 'Invalid memory entry',
    status: 400,
    why: message,
    fix: 'Fix the flagged fields and try again.',
  })
}

function decodeId(publicId: string): number | null {
  try {
    const decodedId = decodePublicId(publicId)

    return Number.isSafeInteger(decodedId) ? decodedId : null
  } catch {
    return null
  }
}

function normalizeSourceChatIds(sourceChatIds: string[] | undefined): string[] {
  if (!sourceChatIds) {
    return []
  }

  return [...new Set(sourceChatIds)].slice(-MEMORY_LIMITS.maxSourceChatIds)
}

function projectCondition(projectId: string | null) {
  return projectId === null
    ? isNull(schema.memoryEntries.projectId)
    : eq(schema.memoryEntries.projectId, projectId)
}

async function resolveOwnedProjectId(
  db: DbClient,
  userId: number,
  projectId: string,
): Promise<number> {
  const decodedProjectId = decodeId(projectId)

  if (decodedProjectId === null) {
    throw createNotFoundError('Project not found')
  }

  const [project] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(
      eq(schema.projects.id, projectId),
      eq(schema.projects.userId, userId),
    ))
    .limit(1)

  if (!project) {
    throw createNotFoundError('Project not found')
  }

  return decodedProjectId
}

export async function assertOwnedProject(
  db: DbClient,
  userId: number,
  projectId: string,
): Promise<void> {
  await resolveOwnedProjectId(db, userId, projectId)
}

async function selectOwnedRow(
  db: DbClient,
  userId: number,
  id: string,
): Promise<MemoryEntryRow | null> {
  if (decodeId(id) === null) {
    return null
  }

  const [row] = await db
    .select()
    .from(schema.memoryEntries)
    .where(and(
      eq(schema.memoryEntries.id, id),
      eq(schema.memoryEntries.userId, userId),
    ))
    .limit(1)

  return row ?? null
}

export async function getMemoryEntry(options: {
  db: DbClient
  userId: number
  id: string
}): Promise<MemoryEntry | null> {
  const row = await selectOwnedRow(options.db, options.userId, options.id)

  return row ? toMemoryEntryWire(row) : null
}

export async function findMemoryEntryBySlug(options: {
  db: DbClient
  userId: number
  projectId: string | null
  category: MemoryCategory
  slug: string
}): Promise<MemoryEntry | null> {
  const [row] = await options.db
    .select()
    .from(schema.memoryEntries)
    .where(and(
      eq(schema.memoryEntries.userId, options.userId),
      eq(schema.memoryEntries.category, options.category),
      eq(schema.memoryEntries.slug, options.slug),
      projectCondition(options.projectId),
    ))
    .limit(1)

  return row ? toMemoryEntryWire(row) : null
}

function sortMemoryEntries(entries: MemoryEntry[]): MemoryEntry[] {
  return entries.sort((first, second) => {
    const categoryOrder = memoryCategories.indexOf(first.category)
      - memoryCategories.indexOf(second.category)

    if (categoryOrder !== 0) {
      return categoryOrder
    }

    return first.title.localeCompare(second.title)
      || first.slug.localeCompare(second.slug)
  })
}

async function buildScopeCondition(
  db: DbClient,
  userId: number,
  scope: MemoryScopeFilter,
) {
  if (scope.kind === 'all') {
    return undefined
  }

  if (scope.kind === 'account') {
    return isNull(schema.memoryEntries.projectId)
  }

  await assertOwnedProject(db, userId, scope.projectId)

  return eq(schema.memoryEntries.projectId, scope.projectId)
}

export async function listMemoryEntries(options: {
  db: DbClient
  userId: number
  scope: MemoryScopeFilter
}): Promise<MemoryEntry[]> {
  const scopeCondition = await buildScopeCondition(
    options.db,
    options.userId,
    options.scope,
  )

  const rows = await options.db
    .select()
    .from(schema.memoryEntries)
    .where(and(
      eq(schema.memoryEntries.userId, options.userId),
      scopeCondition,
    ))

  return sortMemoryEntries(rows.map(toMemoryEntryWire))
}

interface GuardedInsertValues {
  userId: number
  decodedProjectId: number | null
  category: MemoryCategory
  slug: string
  title: string
  description: string
  body: string
  origin: MemoryOrigin
  sourceChatIds: string[]
  sourceMessageId: string | null
}

async function runGuardedInsert(
  db: DbClient,
  values: GuardedInsertValues,
): Promise<number | null> {
  const timestamp = Math.floor(Date.now() / 1000)
  const cap = values.decodedProjectId === null
    ? MEMORY_LIMITS.maxAccountEntries
    : MEMORY_LIMITS.maxProjectEntries
  const ownershipGuard = values.decodedProjectId === null
    ? sql`1 = 1`
    : sql`exists (select 1 from projects where id = ${values.decodedProjectId} and user_id = ${values.userId})`

  const rows = await db.all<{ id: number }>(sql`
    insert into memory_entries (
      created_at, updated_at, user_id, project_id, category, slug, title,
      description, body, sensitivity, sensitive_category, origin,
      source_chat_ids, source_message_id
    )
    select
      ${timestamp}, ${timestamp}, ${values.userId},
      ${values.decodedProjectId}, ${values.category}, ${values.slug},
      ${values.title}, ${values.description}, ${values.body},
      'none', null, ${values.origin},
      ${JSON.stringify(values.sourceChatIds)}, ${values.sourceMessageId}
    where (
      select count(*) from memory_entries
      where user_id = ${values.userId}
        and project_id is ${values.decodedProjectId}
    ) < ${cap}
    and ${ownershipGuard}
    returning id
  `)

  const [row] = rows

  return row ? Number(row.id) : null
}

async function throwInsertRejection(
  db: DbClient,
  values: GuardedInsertValues,
  projectId: string | null,
): Promise<never> {
  if (projectId !== null) {
    await assertOwnedProject(db, values.userId, projectId)
  }

  if (isSingletonCategory(values.category)) {
    const [existingSingleton] = await db
      .select({ id: schema.memoryEntries.id })
      .from(schema.memoryEntries)
      .where(and(
        eq(schema.memoryEntries.userId, values.userId),
        eq(schema.memoryEntries.category, values.category),
        projectCondition(projectId),
      ))
      .limit(1)

    if (existingSingleton) {
      throw createUniqueConflictError(values.category)
    }
  }

  const [counted] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.memoryEntries)
    .where(and(
      eq(schema.memoryEntries.userId, values.userId),
      projectCondition(projectId),
    ))
  const cap = projectId === null
    ? MEMORY_LIMITS.maxAccountEntries
    : MEMORY_LIMITS.maxProjectEntries

  if (Number(counted?.total ?? 0) >= cap) {
    throw createLimitError(projectId !== null)
  }

  throw createError({
    message: 'The memory entry could not be saved',
    status: 409,
    why: 'The memory changed while it was being saved.',
    fix: 'Try again.',
  })
}

async function readTakenSlugs(
  db: DbClient,
  userId: number,
  projectId: string | null,
  category: MemoryCategory,
): Promise<Set<string>> {
  const rows = await db
    .select({ slug: schema.memoryEntries.slug })
    .from(schema.memoryEntries)
    .where(and(
      eq(schema.memoryEntries.userId, userId),
      eq(schema.memoryEntries.category, category),
      projectCondition(projectId),
    ))

  return new Set(rows.map((row) => {
    return row.slug
  }))
}

function findFirstFreeSlugAttempt(
  baseSlug: string,
  takenSlugs: Set<string>,
): number {
  let attempt = 1

  while (takenSlugs.has(suffixMemorySlug(baseSlug, attempt))) {
    attempt += 1
  }

  return attempt
}

async function insertEntryWithSlug(
  db: DbClient,
  values: Omit<GuardedInsertValues, 'slug'>,
  slugPlan: { fixedSlug: string | null, baseSlug: string },
  projectId: string | null,
): Promise<number> {
  let attempt = 1

  if (slugPlan.fixedSlug === null) {
    const takenSlugs = await readTakenSlugs(
      db,
      values.userId,
      projectId,
      values.category,
    )

    attempt = findFirstFreeSlugAttempt(slugPlan.baseSlug, takenSlugs)
  }

  const lastAttempt = attempt + SLUG_RACE_RETRIES

  for (; attempt <= lastAttempt; attempt++) {
    const slug = slugPlan.fixedSlug
      ?? suffixMemorySlug(slugPlan.baseSlug, attempt)
    const insertValues = { ...values, slug }

    try {
      const insertedId = await runGuardedInsert(db, insertValues)

      if (insertedId === null) {
        return await throwInsertRejection(db, insertValues, projectId)
      }

      return insertedId
    } catch (exception) {
      if (!isUniqueViolation(exception)) {
        throw exception
      }

      if (slugPlan.fixedSlug !== null) {
        throw createUniqueConflictError(values.category)
      }
    }
  }

  throw createUniqueConflictError(values.category)
}

export async function createMemoryEntry(
  context: MemoryWriteContext,
  options: CreateMemoryEntryOptions,
): Promise<MemoryEntry> {
  const { db, userId } = context
  const logger = context.logger ?? NOOP_LOGGER
  const parsed = memoryEntryInputSchema.safeParse(options.input)

  if (!parsed.success) {
    return throwInvalidEntry(parsed.error.message)
  }

  const input = parsed.data
  const projectId = input.projectId ?? null

  const decodedProjectId = projectId === null
    ? null
    : await resolveOwnedProjectId(db, userId, projectId)

  assertEntryAllowed(
    evaluateMemoryEntry({
      title: input.title,
      description: input.description,
      body: input.body,
      sensitivity: readDeclaredSensitivity(input),
    }),
    logger,
    options.complianceOrigin,
  )

  const fixedSlug = isSingletonCategory(input.category)
    ? input.category
    : (input.slug ?? null)

  const insertedId = await insertEntryWithSlug(
    db,
    {
      userId,
      decodedProjectId,
      category: input.category,
      title: input.title,
      description: input.description,
      body: input.body,
      origin: options.origin,
      sourceChatIds: normalizeSourceChatIds(options.sourceChatIds),
      sourceMessageId: options.sourceMessageId ?? null,
    },
    { fixedSlug, baseSlug: slugifyMemoryTitle(input.title) },
    projectId,
  )

  const row = await selectOwnedRow(db, userId, encodePublicId(insertedId))

  if (!row) {
    throw createNotFoundError('Memory entry not found')
  }

  return toMemoryEntryWire(row)
}

interface MergedMemoryFields {
  category: MemoryCategory
  title: string
  description: string
  body: string
}

function mergeMemoryPatch(
  stored: MemoryEntryRow,
  patch: MemoryEntryPatch,
): MergedMemoryFields {
  return {
    category: patch.category ?? stored.category,
    title: patch.title ?? stored.title,
    description: patch.description ?? stored.description,
    body: patch.body ?? stored.body,
  }
}

export async function updateMemoryEntry(
  context: MemoryWriteContext,
  options: UpdateMemoryEntryOptions,
): Promise<{ entry: MemoryEntry, previous: MemoryEntry }> {
  const { db, userId } = context
  const logger = context.logger ?? NOOP_LOGGER

  const parsedPatch = memoryEntryPatchSchema.safeParse(options.patch)

  if (!parsedPatch.success) {
    return throwInvalidEntry(parsedPatch.error.message)
  }

  const stored = await selectOwnedRow(db, userId, options.id)

  if (!stored) {
    throw createNotFoundError('Memory entry not found')
  }

  const merged = mergeMemoryPatch(stored, parsedPatch.data)
  const parsedMerged = memoryEntryInputSchema.safeParse(merged)

  if (!parsedMerged.success) {
    return throwInvalidEntry(parsedMerged.error.message)
  }

  assertEntryAllowed(
    evaluateMemoryEntry({
      title: parsedMerged.data.title,
      description: parsedMerged.data.description,
      body: parsedMerged.data.body,
      sensitivity: readDeclaredSensitivity(parsedPatch.data),
    }),
    logger,
    options.complianceOrigin,
  )

  const movesIntoSingleton = merged.category !== stored.category
    && isSingletonCategory(merged.category)

  try {
    const [updated] = await db
      .update(schema.memoryEntries)
      .set({
        category: parsedMerged.data.category,
        title: parsedMerged.data.title,
        description: parsedMerged.data.description,
        body: parsedMerged.data.body,
        updatedAt: new Date(),
        ...(movesIntoSingleton ? { slug: merged.category } : {}),
        ...(options.origin ? { origin: options.origin } : {}),
        ...(options.sourceChatIds
          ? { sourceChatIds: normalizeSourceChatIds(options.sourceChatIds) }
          : {}),
        ...(options.sourceMessageId !== undefined
          ? { sourceMessageId: options.sourceMessageId }
          : {}),
      })
      .where(and(
        eq(schema.memoryEntries.id, options.id),
        eq(schema.memoryEntries.userId, userId),
      ))
      .returning()

    if (!updated) {
      return await throwUpdateRejection(db, userId, options.id)
    }

    return {
      entry: toMemoryEntryWire(updated),
      previous: toMemoryEntryWire(stored),
    }
  } catch (exception) {
    if (isUniqueViolation(exception)) {
      throw createUniqueConflictError(merged.category)
    }

    throw exception
  }
}

async function throwUpdateRejection(
  db: DbClient,
  userId: number,
  id: string,
): Promise<never> {
  const stillStored = await selectOwnedRow(db, userId, id)

  if (!stillStored) {
    throw createNotFoundError('Memory entry not found')
  }

  throw createError({
    message: 'The memory entry could not be saved',
    status: 409,
    why: 'The memory changed while it was being saved.',
    fix: 'Try again.',
  })
}

export async function deleteMemoryEntry(options: {
  db: DbClient
  userId: number
  id: string
}): Promise<MemoryEntry | null> {
  if (decodeId(options.id) === null) {
    return null
  }

  const [deleted] = await options.db
    .delete(schema.memoryEntries)
    .where(and(
      eq(schema.memoryEntries.id, options.id),
      eq(schema.memoryEntries.userId, options.userId),
    ))
    .returning()

  return deleted ? toMemoryEntryWire(deleted) : null
}

export async function resetMemoryEntries(options: {
  db: DbClient
  userId: number
  scope: MemoryScopeFilter
}): Promise<number> {
  const scopeCondition = await buildScopeCondition(
    options.db,
    options.userId,
    options.scope,
  )

  const deleted = await options.db
    .delete(schema.memoryEntries)
    .where(and(
      eq(schema.memoryEntries.userId, options.userId),
      scopeCondition,
    ))
    .returning({ id: schema.memoryEntries.id })

  return deleted.length
}

export async function buildMemoryExport(options: {
  db: DbClient
  userId: number
}): Promise<MemoryExport> {
  const { db, userId } = options

  const [settings] = await db
    .select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId))
    .limit(1)

  const projectRows = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      useAccountMemory: schema.projects.useAccountMemory,
      memory: schema.projects.memory,
    })
    .from(schema.projects)
    .where(and(
      eq(schema.projects.userId, userId),
      or(
        sql`trim(coalesce(${schema.projects.memory}, '')) <> ''`,
        sql`exists (select 1 from memory_entries where memory_entries.project_id = ${schema.projects.id} and memory_entries.user_id = ${userId})`,
      ),
    ))
    .orderBy(schema.projects.name)

  const entries = await listMemoryEntries({
    db,
    userId,
    scope: { kind: 'all' },
  })

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      memoryEnabled: settings?.memoryEnabled
        ?? MEMORY_SETTING_DEFAULTS.memoryEnabled,
      chatSearchEnabled: settings?.chatSearchEnabled
        ?? MEMORY_SETTING_DEFAULTS.chatSearchEnabled,
      memoryIncludeSensitive: MEMORY_SETTING_DEFAULTS.memoryIncludeSensitive,
      memoryExtractionEnabled: settings?.memoryExtractionEnabled
        ?? MEMORY_SETTING_DEFAULTS.memoryExtractionEnabled,
      aboutMe: settings?.aboutMe?.trim() || MEMORY_SETTING_DEFAULTS.aboutMe,
      profileMemoryModel: settings?.profileMemoryModel ?? null,
      profileMemoryGateway: settings?.profileMemoryGateway ?? null,
      projectMemoryModel: settings?.projectMemoryModel ?? null,
      projectMemoryGateway: settings?.projectMemoryGateway ?? null,
    },
    projects: projectRows.map((project) => {
      return {
        id: project.id,
        name: project.name,
        useAccountMemory: project.useAccountMemory
          ?? MEMORY_SETTING_DEFAULTS.useAccountMemory,
        legacyMemory: project.memory?.trim() ? project.memory : null,
      }
    }),
    entries,
  }
}
