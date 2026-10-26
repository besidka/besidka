import { Output, generateText } from 'ai'
import type {
  ComplianceBlockedCounts,
  MemoryCategory,
  MemoryScope,
} from '#shared/types/memory.d'
import type {
  MemoryInstructEntryFields,
  MemoryInstructModelInfo,
  MemoryInstructPreviewOperation,
  MemoryInstructPreviewResponse,
  MemoryInstructRejection,
} from '#shared/types/memory-instruct.d'
import { MEMORY_INSTRUCT_LIMITS } from '#shared/utils/memory-instruct'
import { REDACTION_PLACEHOLDER } from '#shared/utils/memory-policy'
import { getModel } from '#shared/utils/model'
import { redactNeverStore } from '~~/server/utils/memory/compliance'
import type { ComplianceLogger } from '~~/server/utils/memory/compliance'
import { memoryExtractionErrorSummary } from '~~/server/utils/memory/extract-error'
import {
  memoryExtractionEvidenceNeedle,
  prepareMemoryExtractionGroundingText,
} from '~~/server/utils/memory/extract-grounding'
import { loadMemoryExtractionIndex } from '~~/server/utils/memory/extract-input'
import type { MemoryExtractionIndexEntry } from '~~/server/utils/memory/extract-input'
import {
  MEMORY_EXTRACTION_LIMITS,
  clampMemoryExtractionOutputTokens,
} from '~~/server/utils/memory/extract-limits'
import {
  buildMemoryInstructInstructions,
  buildMemoryInstructPromptContent,
  memoryInstructEntryRef,
  memoryInstructModelOutputSchema,
  selectMemoryInstructBodies,
} from '~~/server/utils/memory/instruct-prompt'
import type { MemoryInstructModelOp } from '~~/server/utils/memory/instruct-prompt'
import {
  appendMemoryBodyLines,
  checkMemoryInstructEntry,
  createMemoryInstructComplianceTally,
  isSingletonMemoryCategory,
  memoryInstructEntryCap,
  recordMemoryInstructCompliance,
} from '~~/server/utils/memory/instruct-verdict'
import type { MemoryInstructComplianceTally } from '~~/server/utils/memory/instruct-verdict'
import { resolveMemoryModel } from '~~/server/utils/memory/resolve-model'
import { memoryJevRejection } from '~~/server/utils/memory/jev-check'
import type { MemoryJevChecker } from '~~/server/utils/memory/jev-check'
import type { ResolvedMemoryModel } from '~~/server/utils/memory/resolve-model'

type DbClient = ReturnType<typeof useDb>

const DEFAULT_DELETE_REASON = 'You asked to forget this.'

const LIMIT_REJECTION: MemoryInstructRejection = {
  message: 'Memory limit reached',
  why: 'This would go over the number of entries memory can hold.',
}

const NOT_FOUND_REJECTION: MemoryInstructRejection = {
  message: 'Memory entry not found',
  why: 'The change points to an entry that does not exist.',
}

const ALREADY_CHANGED_REJECTION: MemoryInstructRejection = {
  message: 'Entry already changed above',
  why: 'Only one change per entry is applied at a time.',
}

const UNGROUNDED_DELETE_REJECTION: MemoryInstructRejection = {
  message: 'Not removed',
  why: 'Your text does not explicitly ask to forget this entry.',
}

const MISSING_CATEGORY_REJECTION: MemoryInstructRejection = {
  message: 'Invalid memory entry',
  why: 'A new entry needs a category.',
}

export interface MemoryInstructPreviewInput {
  db: DbClient
  userId: number
  projectId: string | null
  text: string
  logger?: ComplianceLogger
  selection?: ResolvedMemoryModel
  jev?: MemoryJevChecker | null
}

export interface MemoryInstructUsage {
  inputTokens: number
  outputTokens: number
}

export type MemoryInstructPreviewResult
  = | {
    status: 'ready'
    response: MemoryInstructPreviewResponse
    usage: MemoryInstructUsage
  }
  | { status: 'no-text', blocked: ComplianceBlockedCounts }
  | { status: 'no-model' }
  | { status: 'failed', reason: string, model: MemoryInstructModelInfo }

interface PlanningContext {
  entriesByRef: Map<string, MemoryExtractionIndexEntry>
  groundingText: string
  targetedIds: Set<string>
  createdSingletons: Set<MemoryCategory>
  tally: MemoryInstructComplianceTally
}

function memoryInstructScope(projectId: string | null): MemoryScope {
  return projectId === null ? 'profile' : 'project'
}

function toModelInfo(selection: ResolvedMemoryModel): MemoryInstructModelInfo {
  return {
    source: selection.source,
    providerId: selection.providerId,
    gatewayId: selection.gatewayId,
    modelId: selection.modelId,
    modelName: selection.modelName,
  }
}

function modelOutputLimit(selection: ResolvedMemoryModel): number | null {
  if (selection.gatewayId) {
    return null
  }

  return getModel(selection.modelId).model?.maxOutputTokens ?? null
}

function failureLabel(exception: unknown): string {
  const summary = memoryExtractionErrorSummary(exception)

  return summary.status === undefined
    ? summary.errorName
    : `${summary.errorName}:${summary.status}`
}

function entryFields(
  entry: MemoryExtractionIndexEntry,
): MemoryInstructEntryFields {
  return {
    title: entry.title,
    description: entry.description,
    body: entry.body,
  }
}

function hasFieldChanges(
  before: MemoryInstructEntryFields,
  after: MemoryInstructEntryFields,
): boolean {
  return before.title !== after.title
    || before.description !== after.description
    || before.body !== after.body
}

function trimmedOrNull(value: string | null): string | null {
  const trimmed = value?.trim()

  return trimmed ? trimmed : null
}

function rejectedOperation(
  base: Omit<MemoryInstructPreviewOperation, 'status' | 'rejection'>,
  rejection: MemoryInstructRejection,
): MemoryInstructPreviewOperation {
  return { ...base, status: 'rejected', rejection }
}

function readyOperation(
  base: Omit<MemoryInstructPreviewOperation, 'status' | 'rejection'>,
): MemoryInstructPreviewOperation {
  return { ...base, status: 'ready', rejection: null }
}

function isDeleteGrounded(evidence: string | null, groundingText: string) {
  if (!evidence) {
    return false
  }

  const needle = memoryExtractionEvidenceNeedle(evidence)

  return needle.length >= MEMORY_EXTRACTION_LIMITS.evidenceShortMinChars
    && groundingText.includes(needle)
}

function findExistingSingleton(
  context: PlanningContext,
  category: MemoryCategory,
): MemoryExtractionIndexEntry | null {
  for (const entry of context.entriesByRef.values()) {
    if (entry.category === category) {
      return entry
    }
  }

  return null
}

function planUpdate(
  key: string,
  op: MemoryInstructModelOp,
  entry: MemoryExtractionIndexEntry,
  context: PlanningContext,
): MemoryInstructPreviewOperation | null {
  const before = entryFields(entry)
  const proposedBody = trimmedOrNull(op.body)
  let body = before.body

  if (proposedBody !== null) {
    body = entry.bodyHidden
      ? appendMemoryBodyLines(before.body, proposedBody)
      : proposedBody
  }

  const after = {
    title: trimmedOrNull(op.title) ?? before.title,
    description: trimmedOrNull(op.description) ?? before.description,
    body,
  }
  const base = {
    key,
    kind: 'update' as const,
    category: entry.category,
    id: entry.id,
    updatedAt: entry.updatedAt.toISOString(),
    before,
    after,
    reason: null,
  }

  if (context.targetedIds.has(entry.id)) {
    return rejectedOperation(base, ALREADY_CHANGED_REJECTION)
  }

  if (!hasFieldChanges(before, after)) {
    return null
  }

  context.targetedIds.add(entry.id)

  const check = checkMemoryInstructEntry(
    { category: entry.category, ...after },
    context.tally,
  )

  if (!check.allowed) {
    return rejectedOperation(base, check.rejection)
  }

  return readyOperation({ ...base, after: check.fields })
}

function planCreate(
  key: string,
  op: MemoryInstructModelOp,
  context: PlanningContext,
): MemoryInstructPreviewOperation | null {
  const after = {
    title: op.title?.trim() ?? '',
    description: op.description?.trim() ?? '',
    body: op.body?.trim() ?? '',
  }

  if (!op.category) {
    return rejectedOperation({
      key,
      kind: 'create',
      category: 'topics',
      id: null,
      updatedAt: null,
      before: null,
      after,
      reason: null,
    }, MISSING_CATEGORY_REJECTION)
  }

  if (isSingletonMemoryCategory(op.category)) {
    const existing = findExistingSingleton(context, op.category)

    if (existing) {
      return planUpdate(key, {
        ...op,
        title: null,
        description: null,
      }, { ...existing, bodyHidden: true }, context)
    }

    if (context.createdSingletons.has(op.category)) {
      return rejectedOperation({
        key,
        kind: 'create',
        category: op.category,
        id: null,
        updatedAt: null,
        before: null,
        after,
        reason: null,
      }, ALREADY_CHANGED_REJECTION)
    }

    context.createdSingletons.add(op.category)
  }

  const base = {
    key,
    kind: 'create' as const,
    category: op.category,
    id: null,
    updatedAt: null,
    before: null,
    after,
    reason: null,
  }
  const check = checkMemoryInstructEntry(
    { category: op.category, ...after },
    context.tally,
  )

  if (!check.allowed) {
    return rejectedOperation(base, check.rejection)
  }

  return readyOperation({ ...base, after: check.fields })
}

function planDelete(
  key: string,
  op: MemoryInstructModelOp,
  entry: MemoryExtractionIndexEntry,
  context: PlanningContext,
): MemoryInstructPreviewOperation {
  const reason = trimmedOrNull(op.reason)
    ?.slice(0, MEMORY_INSTRUCT_LIMITS.maxReasonChars) ?? DEFAULT_DELETE_REASON
  const base = {
    key,
    kind: 'delete' as const,
    category: entry.category,
    id: entry.id,
    updatedAt: entry.updatedAt.toISOString(),
    before: entryFields(entry),
    after: null,
    reason,
  }

  if (context.targetedIds.has(entry.id)) {
    return rejectedOperation(base, ALREADY_CHANGED_REJECTION)
  }

  if (!isDeleteGrounded(op.evidence, context.groundingText)) {
    return rejectedOperation(base, UNGROUNDED_DELETE_REJECTION)
  }

  context.targetedIds.add(entry.id)

  return readyOperation(base)
}

function planOperation(
  index: number,
  op: MemoryInstructModelOp,
  context: PlanningContext,
): MemoryInstructPreviewOperation | null {
  const key = `op-${index}`

  if (op.op === 'create') {
    return planCreate(key, op, context)
  }

  const entry = op.ref ? context.entriesByRef.get(op.ref.trim()) : undefined

  if (!entry) {
    return rejectedOperation({
      key,
      kind: op.op,
      category: op.category ?? 'topics',
      id: null,
      updatedAt: null,
      before: null,
      after: null,
      reason: null,
    }, NOT_FOUND_REJECTION)
  }

  return op.op === 'update'
    ? planUpdate(key, op, entry, context)
    : planDelete(key, op, entry, context)
}

function applyCapacity(
  operations: MemoryInstructPreviewOperation[],
  total: number,
  limit: number,
): MemoryInstructPreviewOperation[] {
  const readyDeletes = operations.filter((operation) => {
    return operation.kind === 'delete' && operation.status === 'ready'
  }).length
  let room = limit - total + readyDeletes

  return operations.map((operation) => {
    if (operation.kind !== 'create' || operation.status !== 'ready') {
      return operation
    }

    if (room <= 0) {
      return { ...operation, status: 'rejected', rejection: LIMIT_REJECTION }
    }

    room -= 1

    return operation
  })
}

/**
 * Turns the model's proposed ops into preview rows without writing anything.
 * Every create and update is checked like an entry CRUD write (field rules,
 * byte caps, the compliance gate), a `create` for an existing profile or
 * preferences entry becomes an update that adds its bullets, an update of an
 * entry whose body the model was not shown only adds lines, a delete needs a
 * verbatim quote of the user's request, and creates past the entry cap
 * (counting the proposed deletes) are rejected. A second op on the same entry
 * is rejected, and an update that changes nothing is dropped.
 */
export function planMemoryInstructOperations(input: {
  ops: MemoryInstructModelOp[]
  entries: MemoryExtractionIndexEntry[]
  projectId: string | null
  total: number
  groundingText: string
  tally: MemoryInstructComplianceTally
}): MemoryInstructPreviewOperation[] {
  const context: PlanningContext = {
    entriesByRef: new Map(input.entries.map((entry) => {
      return [memoryInstructEntryRef(entry), entry]
    })),
    groundingText: input.groundingText,
    targetedIds: new Set(),
    createdSingletons: new Set(),
    tally: input.tally,
  }
  const planned = input.ops
    .slice(0, MEMORY_INSTRUCT_LIMITS.maxOperations)
    .map((op, index) => planOperation(index, op, context))
    .filter((operation): operation is MemoryInstructPreviewOperation => {
      return operation !== null
    })

  return applyCapacity(
    planned,
    input.total,
    memoryInstructEntryCap(input.projectId),
  )
}

function jevGroundingSource(
  operation: MemoryInstructPreviewOperation,
  instructionText: string,
): string {
  if (operation.before === null) {
    return instructionText
  }

  const { title, description, body } = operation.before

  return [instructionText, title, description, body].join('\n')
}

/**
 * Sends every ready create and update of a preview to TypeSafe AI Jev and
 * turns the ones it flags (sensitive, never-store, or not backed by the
 * user's instruction plus the entry's saved text) into rejected rows marked
 * `kind: 'extra-check'`. Without a checker, or when Jev is unavailable, the
 * rows stay as the deterministic planning left them.
 */
async function rejectJevFlaggedOperations(
  operations: MemoryInstructPreviewOperation[],
  instructionText: string,
  jev: MemoryJevChecker | null | undefined,
): Promise<MemoryInstructPreviewOperation[]> {
  if (!jev) {
    return operations
  }

  const candidates = operations.filter((operation) => {
    return operation.status === 'ready' && operation.after !== null
  })

  if (candidates.length === 0) {
    return operations
  }

  const verdicts = await jev.check(candidates.map((operation) => {
    return {
      ...operation.after!,
      source: jevGroundingSource(operation, instructionText),
    }
  }))
  const verdictsByKey = new Map(candidates.map((operation, index) => {
    return [operation.key, verdicts[index]]
  }))

  return operations.map((operation) => {
    const verdict = verdictsByKey.get(operation.key)

    if (!verdict || verdict.kind === 'clear') {
      return operation
    }

    return {
      ...operation,
      status: 'rejected',
      rejection: memoryJevRejection(verdict),
    }
  })
}

async function generateMemoryInstructOps(
  selection: ResolvedMemoryModel,
  scope: MemoryScope,
  content: string,
) {
  const instance = await selection.instantiate()

  return await generateText({
    model: instance.model,
    reasoning: instance.reasoning,
    providerOptions: {
      ...instance.providerOptions,
      openai: {
        ...instance.providerOptions.openai,
        strictJsonSchema: false,
      },
    },
    output: Output.object({
      schema: memoryInstructModelOutputSchema,
      name: 'MemoryInstruct',
    }),
    maxOutputTokens: clampMemoryExtractionOutputTokens(
      modelOutputLimit(selection),
    ),
    abortSignal: AbortSignal.timeout(
      MEMORY_EXTRACTION_LIMITS.generationTimeoutMs,
    ),
    instructions: buildMemoryInstructInstructions(scope),
    messages: [{ role: 'user', content }],
  })
}

/**
 * Previews what the user's free-text instruction would change in one memory
 * scope (account when `projectId` is null, else that project, whose
 * ownership the caller has checked). Never-store data is redacted out of the
 * text before the single model call on the user's own key, the model sees
 * the scope's index with only the relevant bodies (see
 * `selectMemoryInstructBodies`), and its ops are planned by
 * `planMemoryInstructOperations`. Nothing is written, and the text is never
 * logged or returned.
 */
export async function previewMemoryInstruction(
  input: MemoryInstructPreviewInput,
): Promise<MemoryInstructPreviewResult> {
  const { db, userId, projectId } = input
  const redaction = redactNeverStore(input.text)
  const redactedText = redaction.text
  const tally = createMemoryInstructComplianceTally()

  tally.blocked = { ...redaction.blocked }

  if (redactedText.replaceAll(REDACTION_PLACEHOLDER, '').trim() === '') {
    if (input.logger) {
      recordMemoryInstructCompliance(tally, input.logger)
    }

    return { status: 'no-text', blocked: redaction.blocked }
  }

  const scope = memoryInstructScope(projectId)
  const indexEntries = await loadMemoryExtractionIndex(userId, projectId, db)
  const storedEntries = indexEntries.filter((entry) => {
    return entry.sensitivity !== 'special'
  })
  const selection = input.selection ?? await resolveMemoryModel({
    userId,
    scope,
    projectId,
    db,
    logger: input.logger,
  })

  if (!selection) {
    return { status: 'no-model' }
  }

  const model = toModelInfo(selection)
  const entries = selectMemoryInstructBodies(redactedText, storedEntries)
  let ops: MemoryInstructModelOp[]
  let usage: MemoryInstructUsage

  try {
    const generation = await generateMemoryInstructOps(
      selection,
      scope,
      buildMemoryInstructPromptContent({ scope, entries, text: redactedText }),
    )

    ops = generation.output.ops
    usage = {
      inputTokens: generation.usage?.inputTokens ?? 0,
      outputTokens: generation.usage?.outputTokens ?? 0,
    }
  } catch (exception) {
    return { status: 'failed', reason: failureLabel(exception), model }
  }

  const plannedOperations = planMemoryInstructOperations({
    ops,
    entries,
    projectId,
    total: indexEntries.length,
    groundingText: prepareMemoryExtractionGroundingText(redactedText)
      .collapsed,
    tally,
  })
  const operations = await rejectJevFlaggedOperations(
    plannedOperations,
    redactedText,
    input.jev,
  )

  if (input.logger) {
    recordMemoryInstructCompliance(tally, input.logger)
  }

  return {
    status: 'ready',
    usage,
    response: {
      projectId,
      operations,
      blocked: redaction.blocked,
      model,
      capacity: {
        total: indexEntries.length,
        limit: memoryInstructEntryCap(projectId),
      },
    },
  }
}
