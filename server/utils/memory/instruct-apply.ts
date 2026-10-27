import { createError } from 'evlog'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { MemoryCategory } from '#shared/types/memory.d'
import type {
  MemoryInstructApplyResponse,
  MemoryInstructEntryFields,
} from '#shared/types/memory-instruct.d'
import type { MemoryInstructApplyOperation } from '#shared/utils/memory-instruct'
import * as schema from '~~/server/db/schema'
import {
  decodePublicId,
  encodePublicId,
} from '~~/server/utils/custom-db-types'
import type { ComplianceLogger } from '~~/server/utils/memory/compliance'
import {
  assertOwnedProject,
  toMemoryEntryWire,
} from '~~/server/utils/memory/entries'
import type { MemoryEntryRow } from '~~/server/utils/memory/entries'
import {
  slugifyMemoryTitle,
  suffixMemorySlug,
} from '~~/server/utils/memory/entry-slug'
import {
  checkMemoryInstructEntry,
  createMemoryInstructComplianceTally,
  isSingletonMemoryCategory,
  memoryInstructEntryCap,
  recordMemoryInstructCompliance,
} from '~~/server/utils/memory/instruct-verdict'
import type { MemoryInstructComplianceTally } from '~~/server/utils/memory/instruct-verdict'
import {
  MEMORY_JEV_REJECTION_KIND,
  memoryJevRejection,
} from '~~/server/utils/memory/jev-check'
import type { MemoryJevChecker } from '~~/server/utils/memory/jev-check'

type DbClient = ReturnType<typeof useDb>

type CreateOperation = Extract<MemoryInstructApplyOperation, { kind: 'create' }>

type UpdateOperation = Extract<MemoryInstructApplyOperation, { kind: 'update' }>

type DeleteOperation = Extract<MemoryInstructApplyOperation, { kind: 'delete' }>

const MAX_ERROR_CAUSE_DEPTH = 5

const NOOP_LOGGER: ComplianceLogger = {
  set: () => {},
}

export interface MemoryInstructApplyInput {
  db: DbClient
  userId: number
  projectId: string | null
  operations: MemoryInstructApplyOperation[]
  logger?: ComplianceLogger
  jev?: MemoryJevChecker | null
}

interface PlannedCreate {
  category: MemoryCategory
  slug: string
  fields: MemoryInstructEntryFields
}

interface PlannedUpdate {
  row: MemoryEntryRow
  fields: MemoryInstructEntryFields
}

interface ApplyPlan {
  creates: PlannedCreate[]
  updates: PlannedUpdate[]
  deletes: MemoryEntryRow[]
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

function projectCondition(projectId: string | null) {
  return projectId === null
    ? isNull(schema.memoryEntries.projectId)
    : eq(schema.memoryEntries.projectId, projectId)
}

function createStaleError() {
  return createError({
    message: 'Memory changed since the preview',
    status: 409,
    why: 'An entry was edited or removed after the changes were previewed.',
    fix: 'Preview the changes again.',
  })
}

function createNotFoundError() {
  return createError({
    message: 'Memory entry not found',
    status: 404,
    why: 'The entry does not exist in this memory.',
    fix: 'Preview the changes again.',
  })
}

function createLimitError(projectId: string | null) {
  const cap = memoryInstructEntryCap(projectId)

  return createError({
    message: 'Memory limit reached',
    status: 409,
    why: `At most ${cap} entries fit in ${projectId === null
      ? 'your account memory'
      : 'a project'}.`,
    fix: 'Untick some new entries, or remove entries first.',
  })
}

function createSingletonConflictError(category: MemoryCategory) {
  return createError({
    message: `The ${category} entry already exists, edit it instead`,
    status: 409,
    why: `Only one ${category} entry is kept per scope.`,
    fix: 'Preview the changes again.',
  })
}

function createDuplicateTargetError() {
  return createError({
    message: 'Invalid request body',
    status: 400,
    why: 'Each entry can be changed only once per request.',
  })
}

function assertEntryChecked(
  input: { category: MemoryCategory } & MemoryInstructEntryFields,
  tally: MemoryInstructComplianceTally,
  logger: ComplianceLogger,
): MemoryInstructEntryFields {
  const check = checkMemoryInstructEntry(input, tally)

  if (check.allowed) {
    return check.fields
  }

  recordMemoryInstructCompliance(tally, logger)

  throw createError({
    message: check.rejection.message,
    status: check.status,
    why: check.rejection.why,
    fix: check.status === 422
      ? 'Untick this change, or remove the flagged data and preview again.'
      : 'Preview the changes again.',
  })
}

async function assertJevAllowed(
  plan: ApplyPlan,
  jev: MemoryJevChecker | null | undefined,
): Promise<void> {
  const candidates = [
    ...plan.updates.map(update => update.fields),
    ...plan.creates.map(create => create.fields),
  ]

  if (!jev || candidates.length === 0) {
    return
  }

  const verdicts = await jev.check(candidates)

  for (const verdict of verdicts) {
    if (verdict.kind === 'clear') {
      continue
    }

    const rejection = memoryJevRejection(verdict)

    throw createError({
      message: rejection.message,
      status: 422,
      why: rejection.why,
      fix: 'Untick this change, or remove the flagged data and preview again.',
      data: { kind: MEMORY_JEV_REJECTION_KIND, reason: verdict.kind },
    })
  }
}

function findTargetRow(
  rows: MemoryEntryRow[],
  operation: UpdateOperation | DeleteOperation,
): MemoryEntryRow {
  const row = rows.find(candidate => candidate.id === operation.id)

  if (!row) {
    throw createNotFoundError()
  }

  if (row.updatedAt.getTime() !== new Date(operation.updatedAt).getTime()) {
    throw createStaleError()
  }

  return row
}

function assertUniqueTargets(operations: MemoryInstructApplyOperation[]) {
  const targetedIds = new Set<string>()

  for (const operation of operations) {
    if (operation.kind === 'create') {
      continue
    }

    if (targetedIds.has(operation.id)) {
      throw createDuplicateTargetError()
    }

    targetedIds.add(operation.id)
  }
}

function assertSingletonsFree(
  creates: CreateOperation[],
  rows: MemoryEntryRow[],
  deletedIds: Set<string>,
) {
  const takenCategories = new Set(
    rows
      .filter(row => !deletedIds.has(row.id))
      .map(row => row.category),
  )

  for (const operation of creates) {
    if (!isSingletonMemoryCategory(operation.category)) {
      continue
    }

    if (takenCategories.has(operation.category)) {
      throw createSingletonConflictError(operation.category)
    }

    takenCategories.add(operation.category)
  }
}

function assignSlug(
  category: MemoryCategory,
  title: string,
  takenSlugs: Set<string>,
): string {
  if (isSingletonMemoryCategory(category)) {
    return category
  }

  const baseSlug = slugifyMemoryTitle(title)
  let attempt = 1

  while (takenSlugs.has(`${category}/${suffixMemorySlug(baseSlug, attempt)}`)) {
    attempt += 1
  }

  return suffixMemorySlug(baseSlug, attempt)
}

function buildApplyPlan(
  rows: MemoryEntryRow[],
  input: MemoryInstructApplyInput,
  logger: ComplianceLogger,
): ApplyPlan {
  const { operations, projectId } = input
  const tally = createMemoryInstructComplianceTally()

  assertUniqueTargets(operations)

  const deletes = operations
    .filter((operation): operation is DeleteOperation => {
      return operation.kind === 'delete'
    })
    .map(operation => findTargetRow(rows, operation))
  const updates = operations
    .filter((operation): operation is UpdateOperation => {
      return operation.kind === 'update'
    })
    .map((operation) => {
      const row = findTargetRow(rows, operation)
      const fields = assertEntryChecked({
        category: row.category,
        title: operation.title,
        description: operation.description,
        body: operation.body,
      }, tally, logger)

      return { row, fields }
    })
  const createOperations = operations.filter(
    (operation): operation is CreateOperation => {
      return operation.kind === 'create'
    },
  )
  const createFields = createOperations.map((operation) => {
    return assertEntryChecked(operation, tally, logger)
  })

  assertSingletonsFree(
    createOperations,
    rows,
    new Set(deletes.map(row => row.id)),
  )

  if (
    rows.length - deletes.length + createOperations.length
    > memoryInstructEntryCap(projectId)
  ) {
    throw createLimitError(projectId)
  }

  const takenSlugs = new Set(rows.map(row => `${row.category}/${row.slug}`))
  const creates = createOperations.map((operation, index) => {
    const fields = createFields[index]!
    const slug = assignSlug(operation.category, fields.title, takenSlugs)

    takenSlugs.add(`${operation.category}/${slug}`)

    return { category: operation.category, slug, fields }
  })

  recordMemoryInstructCompliance(tally, logger)

  return { creates, updates, deletes }
}

function buildDeleteStatement(
  db: DbClient,
  userId: number,
  projectId: string | null,
  row: MemoryEntryRow,
) {
  return db
    .delete(schema.memoryEntries)
    .where(and(
      eq(schema.memoryEntries.id, row.id),
      eq(schema.memoryEntries.userId, userId),
      projectCondition(projectId),
      eq(schema.memoryEntries.updatedAt, row.updatedAt),
    ))
    .returning({ id: schema.memoryEntries.id })
}

function buildUpdateStatement(
  db: DbClient,
  userId: number,
  projectId: string | null,
  update: PlannedUpdate,
) {
  return db
    .update(schema.memoryEntries)
    .set({
      title: update.fields.title,
      description: update.fields.description,
      body: update.fields.body,
      sensitivity: 'none',
      sensitiveCategory: null,
      origin: 'user',
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.memoryEntries.id, update.row.id),
      eq(schema.memoryEntries.userId, userId),
      projectCondition(projectId),
      eq(schema.memoryEntries.updatedAt, update.row.updatedAt),
    ))
    .returning()
}

function buildCreateStatement(
  db: DbClient,
  userId: number,
  projectId: string | null,
  create: PlannedCreate,
) {
  const timestamp = Math.floor(Date.now() / 1000)
  const decodedProjectId = projectId === null ? null : decodePublicId(projectId)
  const cap = memoryInstructEntryCap(projectId)
  const ownershipGuard = decodedProjectId === null
    ? sql`1 = 1`
    : sql`exists (select 1 from projects where id = ${decodedProjectId} and user_id = ${userId})`

  return db.all<{ id: number }>(sql`
    insert into memory_entries (
      created_at, updated_at, user_id, project_id, category, slug, title,
      description, body, sensitivity, sensitive_category, origin,
      source_chat_ids, source_message_id
    )
    select
      ${timestamp}, ${timestamp}, ${userId}, ${decodedProjectId},
      ${create.category}, ${create.slug}, ${create.fields.title},
      ${create.fields.description}, ${create.fields.body},
      'none', null, 'user', '[]', null
    where (
      select count(*) from memory_entries
      where user_id = ${userId}
        and project_id is ${decodedProjectId}
    ) < ${cap}
    and ${ownershipGuard}
    returning id
  `)
}

async function runApplyBatch(
  db: DbClient,
  statements: PromiseLike<unknown>[],
): Promise<unknown[]> {
  try {
    return await db.batch(statements as unknown as [BatchItem<'sqlite'>])
  } catch (exception) {
    if (isUniqueViolation(exception)) {
      throw createError({
        message: 'An entry with this name already exists',
        status: 409,
        why: 'Another entry was saved with the same name at the same time.',
        fix: 'Preview the changes again.',
      })
    }

    throw exception
  }
}

async function selectRowsByIds(
  db: DbClient,
  userId: number,
  ids: string[],
): Promise<MemoryEntryRow[]> {
  if (ids.length === 0) {
    return []
  }

  return await db
    .select()
    .from(schema.memoryEntries)
    .where(and(
      eq(schema.memoryEntries.userId, userId),
      inArray(schema.memoryEntries.id, ids),
    ))
}

/**
 * Applies the operations the user ticked in a memory instruction preview,
 * with no model call. Each operation is re-validated as an ordinary entry
 * write on the user's own entries in one scope (account when `projectId` is
 * null, else that owned project): update and delete targets must belong to
 * that scope and still carry the `updatedAt` the preview showed (a 409 asks
 * for a new preview otherwise), every create and update passes the field
 * rules and the compliance gate (400 or 422), profile and preferences stay
 * single, and the entry cap must hold after deletes. Everything is then
 * written in one `db.batch()`: deletes, updates and guarded inserts, each
 * keyed on owner, scope and `updatedAt` (inserts on the cap and project
 * ownership), so a concurrent edit is never overwritten. A statement that
 * lands no row because of such a race is counted as `skipped`.
 */
export async function applyMemoryInstruction(
  input: MemoryInstructApplyInput,
): Promise<MemoryInstructApplyResponse> {
  const { db, userId, projectId } = input
  const logger = input.logger ?? NOOP_LOGGER

  if (projectId !== null) {
    await assertOwnedProject(db, userId, projectId)
  }

  const rows = await db
    .select()
    .from(schema.memoryEntries)
    .where(and(
      eq(schema.memoryEntries.userId, userId),
      projectCondition(projectId),
    ))
  const plan = buildApplyPlan(rows, input, logger)

  await assertJevAllowed(plan, input.jev)

  const statements: PromiseLike<unknown>[] = [
    ...plan.deletes.map((row) => {
      return buildDeleteStatement(db, userId, projectId, row)
    }),
    ...plan.updates.map((update) => {
      return buildUpdateStatement(db, userId, projectId, update)
    }),
    ...plan.creates.map((create) => {
      return buildCreateStatement(db, userId, projectId, create)
    }),
  ]
  const results = await runApplyBatch(db, statements)
  const landedIds = results.map((result) => {
    const [landed] = result as Array<{ id: string | number }>

    return landed ? landed.id : null
  })
  const deletedIds = landedIds
    .slice(0, plan.deletes.length)
    .filter((id): id is string => typeof id === 'string')
  const updatedIds = landedIds
    .slice(plan.deletes.length, plan.deletes.length + plan.updates.length)
    .filter((id): id is string => typeof id === 'string')
  const createdIds = landedIds
    .slice(plan.deletes.length + plan.updates.length)
    .filter((id): id is number | string => id !== null)
    .map(id => encodePublicId(Number(id)))
  const changedRows = await selectRowsByIds(
    db,
    userId,
    [...updatedIds, ...createdIds],
  )

  return {
    projectId,
    created: createdIds.length,
    updated: updatedIds.length,
    deleted: deletedIds.length,
    skipped: statements.length
      - createdIds.length
      - updatedIds.length
      - deletedIds.length,
    entries: changedRows.map(toMemoryEntryWire),
    deletedIds,
  }
}
