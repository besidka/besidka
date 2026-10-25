import { parseError } from 'evlog'
import type { KnowledgeExtractionResult } from '~/types/knowledge-extract.d'
import type {
  KnowledgeCommitInput,
  KnowledgeFolderSyncInput,
  KnowledgeItemInput,
  KnowledgePrepareOptions,
  KnowledgeSyncResult,
  KnowledgeSyncSummary,
  KnowledgeUploadEntry,
  KnowledgeUploadEntryStatus,
  KnowledgeUploadFailure,
  KnowledgeUploadPhase,
  KnowledgeUploadProgress,
  KnowledgeUploadSource,
  ProjectKnowledgeError,
} from '~/types/project-knowledge.d'
import type {
  KnowledgeAcceptedEntry,
  KnowledgePlanSummary,
  KnowledgeUploadPlan,
} from '~/utils/knowledge-upload-plan'
import {
  normalizeKnowledgeRelativePath,
  normalizeKnowledgeTitle,
} from '~/utils/knowledge-paths'
import { uploadWithProgress } from '~/utils/upload-with-progress'

interface UploadRecord {
  key: string
  accepted: KnowledgeAcceptedEntry
  fileId: string | null
}

interface PreparedItem {
  key: string
  payload: KnowledgeItemInput
  textBytes: number
}

interface PendingBatch {
  items: PreparedItem[]
  bytes: number
}

interface SyncRemoval {
  itemId: string
  replacedByKey: string | null
  hasKnownHash: boolean
}

interface SyncState {
  removals: SyncRemoval[]
  addKeys: Set<string>
  unchanged: number
  foreignFolderItems: number
  removed: number
  couldNotRemove: number
}

interface RemovalPlan {
  removableIds: string[]
  keptRenamed: number
  keptReplaced: number
  unchangedUnknown: number
}

interface RunContext {
  folderId: string | null
  commitWithLastBatch: boolean
  sync: SyncState | null
}

interface RunState {
  token: number
  projectId: string
  controller: AbortController
  keys: string[]
  processed: Set<string>
  batch: PendingBatch
  stopFailure: KnowledgeUploadFailure | null
}

type PrepareOutcome
  = | { kind: 'item', item: PreparedItem }
    | { kind: 'settled' }
    | { kind: 'cancelled' }
    | { kind: 'stop', failure: KnowledgeUploadFailure }

const MAX_BATCH_ITEMS = 25

const RUN_STOPPING_STATUSES: ReadonlySet<number> = new Set([402, 413, 422, 429])

const STORAGE_MESSAGE_PATTERN = /storage|quota/i

const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/

const FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

const CREATED_STATUSES: readonly KnowledgeUploadEntryStatus[] = [
  'ready',
  'no-text',
]

const STATUS_FALLBACK_MESSAGES: Record<number, string> = {
  402: 'Not enough storage space for this upload.',
  413: 'Not enough storage space for this upload.',
  422: 'This project reached its knowledge limit.',
  429: 'Too many requests. Try again in a moment.',
}

function createEmptyProgress(): KnowledgeUploadProgress {
  return {
    done: 0,
    total: 0,
    currentName: null,
    bytesDone: 0,
    bytesTotal: 0,
  }
}

function createFolderId(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

function toTitle(name: string): string {
  return normalizeKnowledgeTitle(name) || 'Untitled'
}

function toRelativePath(relativePath: string | null): string | null {
  if (relativePath === null) {
    return null
  }

  return normalizeKnowledgeRelativePath(relativePath)
}

function toFolderId(folderId: string | null): string | null {
  if (folderId === null || !FOLDER_ID_PATTERN.test(folderId)) {
    return null
  }

  return folderId
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

function toContentHash(
  extractedHash: string,
  plannedHash: string,
): string | null {
  if (CONTENT_HASH_PATTERN.test(extractedHash)) {
    return extractedHash
  }

  return CONTENT_HASH_PATTERN.test(plannedHash) ? plannedHash : null
}

function toPageCount(pageCount: number | null): number | null {
  if (
    pageCount === null
    || !Number.isInteger(pageCount)
    || pageCount < 0
    || pageCount > KNOWLEDGE_LIMITS.maxPdfPages
  ) {
    return null
  }

  return pageCount
}

function toExtractError(extractError: string | null): string | null {
  return extractError ? extractError.slice(0, 64) : null
}

function toFailure(parsed: ProjectKnowledgeError): KnowledgeUploadFailure {
  return {
    message: parsed.message
      || STATUS_FALLBACK_MESSAGES[parsed.status]
      || 'Something went wrong. Try again.',
    why: parsed.why,
    status: parsed.status,
  }
}

function isRunStopping(parsed: ProjectKnowledgeError): boolean {
  if (RUN_STOPPING_STATUSES.has(parsed.status)) {
    return true
  }

  return parsed.status === 400 && STORAGE_MESSAGE_PATTERN.test(parsed.message)
}

function describeExtractFailure(extractError: string | null): string {
  return extractError
    ? `Couldn't extract text (${extractError}).`
    : 'Couldn\'t extract text.'
}

function resolveExtractedText(
  extracted: KnowledgeExtractionResult,
): { extractStatus: 'ready' | 'no-text', text: string } {
  const isReady = extracted.extractStatus === 'ready'
    && extracted.text.trim().length > 0

  return isReady
    ? { extractStatus: 'ready', text: extracted.text }
    : { extractStatus: 'no-text', text: '' }
}

function buildPayload(
  record: UploadRecord,
  extracted: KnowledgeExtractionResult,
  context: RunContext,
): KnowledgeItemInput {
  const { extractStatus, text } = resolveExtractedText(extracted)
  const payload: KnowledgeItemInput = {
    title: toTitle(record.accepted.name),
    relativePath: toRelativePath(record.accepted.relativePath),
    folderId: toFolderId(context.folderId),
    contentHash: toContentHash(
      extracted.contentHash,
      record.accepted.contentHash,
    ),
    extractor: extracted.extractor,
    extractStatus,
    extractError: extractStatus === 'ready'
      ? null
      : toExtractError(extracted.extractError),
    pageCount: toPageCount(extracted.pageCount),
    text,
  }

  if (record.fileId) {
    payload.fileId = record.fileId

    return payload
  }

  payload.mediaType = extracted.mediaType || 'application/octet-stream'

  return payload
}

function isBatchFull(batch: PendingBatch, item: PreparedItem): boolean {
  if (batch.items.length === 0) {
    return false
  }

  return batch.items.length >= MAX_BATCH_ITEMS
    || batch.bytes + item.textBytes > KNOWLEDGE_LIMITS.maxBatchTextBytes
}

export function useKnowledgeUpload(
  projectId: MaybeRefOrGetter<string | undefined>,
  knowledge: ReturnType<typeof useProjectKnowledge>
    = useProjectKnowledge(projectId),
) {
  const resolvedProjectId = computed<string | undefined>(() => {
    return toValue(projectId) || undefined
  })

  const phase = shallowRef<KnowledgeUploadPhase>('idle')
  const plan = shallowRef<KnowledgePlanSummary | null>(null)
  const syncSummary = shallowRef<KnowledgeSyncSummary | null>(null)
  const syncResult = shallowRef<KnowledgeSyncResult | null>(null)
  const entries = shallowRef<KnowledgeUploadEntry[]>([])
  const progress = shallowRef<KnowledgeUploadProgress>(createEmptyProgress())
  const error = shallowRef<KnowledgeUploadFailure | null>(null)
  const wasCancelled = shallowRef<boolean>(false)

  let records = new Map<string, UploadRecord>()
  let context: RunContext = {
    folderId: null,
    commitWithLastBatch: true,
    sync: null,
  }
  let hasUncommittedBatches = false
  let activeRun: RunState | null = null
  let extraction: ReturnType<typeof useKnowledgeExtraction> | null = null
  let runToken = 0
  let preparationToken = 0

  const failedCount = computed<number>(() => {
    return entries.value.filter(entry => entry.status === 'failed').length
  })

  const isBusy = computed<boolean>(() => {
    return phase.value === 'planning' || phase.value === 'running'
  })

  function getExtraction(): ReturnType<typeof useKnowledgeExtraction> {
    extraction ??= useKnowledgeExtraction()

    return extraction
  }

  function updateEntry(
    key: string,
    patch: Partial<Pick<KnowledgeUploadEntry, 'status' | 'error'>>,
  ): void {
    entries.value = entries.value.map((entry) => {
      return entry.key === key ? { ...entry, ...patch } : entry
    })
  }

  function failEntry(key: string, message: string): void {
    updateEntry(key, { status: 'failed', error: message })
  }

  function clearSession(): void {
    records = new Map()
    context = {
      folderId: null,
      commitWithLastBatch: true,
      sync: null,
    }
    entries.value = []
    plan.value = null
    syncSummary.value = null
    syncResult.value = null
    progress.value = createEmptyProgress()
    error.value = null
    wasCancelled.value = false
  }

  function registerAccepted(
    accepted: KnowledgeAcceptedEntry[],
    fileIds: Map<File, string>,
  ): Map<KnowledgeAcceptedEntry, string> {
    const keyByAccepted = new Map<KnowledgeAcceptedEntry, string>()

    records = new Map()

    entries.value = accepted.map((acceptedEntry, index) => {
      const key = `entry-${index}`

      keyByAccepted.set(acceptedEntry, key)
      records.set(key, {
        key,
        accepted: acceptedEntry,
        fileId: fileIds.get(acceptedEntry.file) ?? null,
      })

      return {
        key,
        name: acceptedEntry.name,
        relativePath: acceptedEntry.relativePath,
        category: acceptedEntry.category,
        sizeBytes: acceptedEntry.file.size,
        status: 'queued',
        error: null,
      }
    })

    return keyByAccepted
  }

  function collectFileIds(sources: KnowledgeUploadSource[]) {
    const fileIds = new Map<File, string>()

    for (const source of sources) {
      if (source.fileId) {
        fileIds.set(source.file, source.fileId)
      }
    }

    return fileIds
  }

  function planUpload(
    sources: KnowledgeUploadSource[],
    gitignoreText: string,
  ): Promise<KnowledgeUploadPlan> {
    return planKnowledgeUpload({
      entries: sources.map((source) => {
        return { file: source.file, relativePath: source.relativePath }
      }),
      gitignoreText,
      existingHashes: new Set<string>(),
    })
  }

  async function beginPlanning(
    sources: KnowledgeUploadSource[],
    gitignoreText: string,
    adopt: (knowledgePlan: KnowledgeUploadPlan) => void,
  ): Promise<void> {
    if (isBusy.value) {
      return
    }

    const targetProjectId = resolvedProjectId.value

    clearSession()

    if (!targetProjectId) {
      error.value = {
        message: 'Select a project first.',
        why: undefined,
        status: 400,
      }
      phase.value = 'error'

      return
    }

    preparationToken += 1

    const token = preparationToken

    phase.value = 'planning'

    try {
      const knowledgePlan = await planUpload(sources, gitignoreText)

      if (
        token !== preparationToken
        || resolvedProjectId.value !== targetProjectId
      ) {
        return
      }

      adopt(knowledgePlan)
      phase.value = 'preview'
    } catch (exception) {
      if (token !== preparationToken) {
        return
      }

      error.value = toFailure(parseError(exception))
      phase.value = 'error'
    }
  }

  function prepare(
    sources: KnowledgeUploadSource[],
    options: KnowledgePrepareOptions = {},
  ): Promise<void> {
    return beginPlanning(
      sources,
      options.gitignoreText ?? '',
      (knowledgePlan) => {
        const hasRelativePaths = knowledgePlan.accepted.some((entry) => {
          return entry.relativePath !== null
        })

        registerAccepted(knowledgePlan.accepted, collectFileIds(sources))
        context = {
          folderId: toFolderId(
            options.folderId ?? (hasRelativePaths ? createFolderId() : null),
          ),
          commitWithLastBatch: true,
          sync: null,
        }
        plan.value = summarizeKnowledgePlan(knowledgePlan)
      },
    )
  }

  async function syncFolder(input: KnowledgeFolderSyncInput): Promise<void> {
    if (isBusy.value) {
      return
    }

    if (toFolderId(input.folderId) !== input.folderId) {
      clearSession()
      error.value = {
        message: 'This folder can not be synced.',
        why: 'The folder id is not valid.',
        status: 400,
      }
      phase.value = 'error'

      return
    }

    await beginPlanning(
      input.incoming,
      input.gitignoreText ?? '',
      (knowledgePlan) => {
        const incomingWithPaths = knowledgePlan.accepted.flatMap((entry) => {
          return entry.relativePath === null
            ? []
            : [{ ...entry, relativePath: entry.relativePath }]
        })
        const foreignFolderItems = input.existing.filter((item) => {
          return item.folderId !== undefined
            && item.folderId !== input.folderId
        })
        const diff = diffFolderSync({
          existing: input.existing.filter((item) => {
            return !foreignFolderItems.includes(item)
          }),
          incoming: incomingWithPaths,
        })
        const queued = [
          ...diff.add,
          ...diff.replace.map(replacement => replacement.incoming),
        ]
        const keyByAccepted = registerAccepted(
          queued,
          collectFileIds(input.incoming),
        )
        const removals: SyncRemoval[] = diff.remove.map((itemId) => {
          return { itemId, replacedByKey: null, hasKnownHash: false }
        })

        for (const replacement of diff.replace) {
          removals.push({
            itemId: replacement.itemId,
            replacedByKey: keyByAccepted.get(replacement.incoming) ?? null,
            hasKnownHash: replacement.hasKnownHash,
          })
        }

        context = {
          folderId: input.folderId,
          commitWithLastBatch: false,
          sync: {
            removals,
            addKeys: new Set<string>(
              diff.add.flatMap(entry => keyByAccepted.get(entry) ?? []),
            ),
            unchanged: diff.unchanged,
            foreignFolderItems: foreignFolderItems.length,
            removed: 0,
            couldNotRemove: 0,
          },
        }
        plan.value = summarizeKnowledgePlan(knowledgePlan)
        syncSummary.value = {
          added: diff.add.length,
          replaced: diff.replace.length,
          removed: diff.remove.length,
          unchanged: diff.unchanged,
          plan: plan.value,
        }
      },
    )
  }

  function isSuperseded(runState: RunState): boolean {
    return runState.token !== runToken
      || resolvedProjectId.value !== runState.projectId
  }

  function publishProgress(
    runState: RunState,
    currentName: string | null,
  ): void {
    let bytesDone = 0
    let bytesTotal = 0

    for (const entry of entries.value) {
      if (!runState.keys.includes(entry.key)) {
        continue
      }

      bytesTotal += entry.sizeBytes

      if (runState.processed.has(entry.key)) {
        bytesDone += entry.sizeBytes
      }
    }

    progress.value = {
      done: runState.processed.size,
      total: runState.keys.length,
      currentName,
      bytesDone,
      bytesTotal,
    }
  }

  async function uploadOriginal(
    record: UploadRecord,
    extracted: KnowledgeExtractionResult,
    signal: AbortSignal,
  ): Promise<string> {
    const { file, name } = record.accepted
    const response = await uploadWithProgress<{ id?: string }>({
      url: '/api/v1/files/upload',
      file,
      headers: {
        'Content-Type': extracted.mediaType || file.type,
        'X-Filename': encodeURIComponent(name),
        'X-Filesize': file.size.toString(),
      },
      signal,
    })
    const fileId = response.data?.id

    if (!fileId) {
      throw new Error('The upload did not return a file id')
    }

    return fileId
  }

  async function prepareEntry(
    record: UploadRecord,
    signal: AbortSignal,
  ): Promise<PrepareOutcome> {
    const { key, accepted } = record

    updateEntry(key, { status: 'extracting', error: null })

    let extracted: KnowledgeExtractionResult

    try {
      extracted = await getExtraction().extractFile(accepted.file, { signal })
    } catch (exception) {
      if (signal.aborted) {
        updateEntry(key, { status: 'queued' })

        return { kind: 'cancelled' }
      }

      failEntry(key, toFailure(parseError(exception)).message)

      return { kind: 'settled' }
    }

    if (extracted.extractStatus === 'failed') {
      failEntry(key, describeExtractFailure(extracted.extractError))

      return { kind: 'settled' }
    }

    const { text } = resolveExtractedText(extracted)
    const textBytes = knowledgeTextByteLength(text)

    if (textBytes > KNOWLEDGE_LIMITS.maxBatchTextBytes) {
      failEntry(key, 'The extracted text is larger than 1 MB.')

      return { kind: 'settled' }
    }

    if (extracted.needsOriginalUpload && !record.fileId) {
      updateEntry(key, { status: 'uploading-original' })

      try {
        record.fileId = await uploadOriginal(record, extracted, signal)
      } catch (exception) {
        if (signal.aborted) {
          updateEntry(key, { status: 'queued' })

          return { kind: 'cancelled' }
        }

        const parsed = parseError(exception)
        const failure = toFailure(parsed)

        failEntry(key, failure.message)

        return isRunStopping(parsed)
          ? { kind: 'stop', failure }
          : { kind: 'settled' }
      }

      updateEntry(key, { status: 'extracting' })
    }

    return {
      kind: 'item',
      item: {
        key,
        payload: buildPayload(record, extracted, context),
        textBytes,
      },
    }
  }

  async function flushBatch(
    batch: PendingBatch,
    commit: boolean,
  ): Promise<KnowledgeUploadFailure | null> {
    if (batch.items.length === 0) {
      return null
    }

    const sentItems = batch.items

    batch.items = []
    batch.bytes = 0

    const outcome = await knowledge.addItems(
      sentItems.map(item => item.payload),
      { commit },
    )

    if (!outcome.ok) {
      const failure = toFailure(outcome.parsed)

      for (const item of sentItems) {
        failEntry(item.key, failure.message)
      }

      return failure
    }

    const skippedIndexes = new Set<number>(
      outcome.result.skipped.map(skipped => skipped.index),
    )

    entries.value = entries.value.map((entry) => {
      const index = sentItems.findIndex(item => item.key === entry.key)

      if (index === -1) {
        return entry
      }

      const sentItem = sentItems[index]
      const status: KnowledgeUploadEntryStatus = skippedIndexes.has(index)
        ? 'skipped-duplicate'
        : sentItem?.payload.extractStatus === 'no-text' ? 'no-text' : 'ready'

      return { ...entry, status, error: null }
    })

    if (commit) {
      hasUncommittedBatches = false
    } else if (outcome.result.items.length > 0) {
      hasUncommittedBatches = true
    }

    return null
  }

  function getEntryStatus(key: string): KnowledgeUploadEntryStatus | null {
    return entries.value.find(entry => entry.key === key)?.status ?? null
  }

  function planRemovals(sync: SyncState, isRunComplete: boolean): RemovalPlan {
    const hasSkippedAdd = Array.from(sync.addKeys).some((key) => {
      return getEntryStatus(key) === 'skipped-duplicate'
    })
    const removalPlan: RemovalPlan = {
      removableIds: [],
      keptRenamed: 0,
      keptReplaced: 0,
      unchangedUnknown: 0,
    }

    for (const removal of sync.removals) {
      if (removal.replacedByKey === null) {
        if (!isRunComplete) {
          continue
        }

        if (hasSkippedAdd) {
          removalPlan.keptRenamed += 1

          continue
        }

        removalPlan.removableIds.push(removal.itemId)

        continue
      }

      const status = getEntryStatus(removal.replacedByKey)

      if (status && CREATED_STATUSES.includes(status)) {
        removalPlan.removableIds.push(removal.itemId)
      } else if (status === 'skipped-duplicate' && removal.hasKnownHash) {
        removalPlan.keptReplaced += 1
      } else if (status === 'skipped-duplicate') {
        removalPlan.unchangedUnknown += 1
      }
    }

    return removalPlan
  }

  function describeSyncNotices(
    sync: SyncState,
    removalPlan: RemovalPlan,
  ): string[] {
    const notices: string[] = []

    if (removalPlan.keptRenamed === 1) {
      notices.push(
        '1 file kept under its old name — it looks like a renamed copy.',
      )
    } else if (removalPlan.keptRenamed > 1) {
      notices.push(
        `${removalPlan.keptRenamed} files kept under their old name — `
        + 'they look like renamed copies.',
      )
    }

    if (sync.foreignFolderItems > 0) {
      const count = sync.foreignFolderItems

      notices.push(
        `${count} ${pluralize(count, 'item belongs', 'items belong')} to a `
        + 'different folder and was kept.',
      )
    }

    if (sync.couldNotRemove > 0) {
      const count = sync.couldNotRemove

      notices.push(
        `${count} ${pluralize(count, 'item', 'items')} could not be removed.`,
      )
    }

    return notices
  }

  function publishSyncResult(
    sync: SyncState,
    removalPlan: RemovalPlan,
  ): void {
    const countStatus = (statuses: readonly KnowledgeUploadEntryStatus[]) => {
      return entries.value.filter((entry) => {
        return statuses.includes(entry.status)
      }).length
    }

    syncResult.value = {
      uploaded: countStatus(CREATED_STATUSES),
      skippedAsDuplicate: countStatus(['skipped-duplicate']),
      kept: removalPlan.keptRenamed
        + removalPlan.keptReplaced
        + sync.foreignFolderItems,
      removed: sync.removed,
      unchanged: sync.unchanged,
      unchangedUnknown: removalPlan.unchangedUnknown,
      couldNotRemove: sync.couldNotRemove,
      notices: describeSyncNotices(sync, removalPlan),
    }
  }

  async function finalizeFolderSync(
    isRunComplete: boolean,
  ): Promise<KnowledgeUploadFailure | null> {
    const sync = context.sync

    if (!sync) {
      return null
    }

    const removalPlan = planRemovals(sync, isRunComplete)
    const { removableIds } = removalPlan
    let failure: KnowledgeUploadFailure | null = null

    if (hasUncommittedBatches || removableIds.length > 0) {
      const body: KnowledgeCommitInput = removableIds.length > 0
        ? { folderId: context.folderId, remove: removableIds }
        : {}
      const outcome = await knowledge.commit(body)

      if (outcome.ok) {
        const skippedIds = new Set<string>(outcome.result.skipped ?? [])
        const skippedCount = removableIds.filter((itemId) => {
          return skippedIds.has(itemId)
        }).length

        sync.removed += removableIds.length - skippedCount
        sync.couldNotRemove += skippedCount
        sync.removals = sync.removals.filter((removal) => {
          return !removableIds.includes(removal.itemId)
        })
        hasUncommittedBatches = false
      } else {
        failure = toFailure(outcome.parsed)
      }
    }

    publishSyncResult(sync, removalPlan)

    return failure
  }

  async function finalizeRun(
    runState: RunState,
    isRunComplete: boolean,
  ): Promise<KnowledgeUploadFailure | null> {
    const flushFailure = await flushBatch(
      runState.batch,
      context.commitWithLastBatch,
    )

    if (!context.commitWithLastBatch) {
      const syncFailure = await finalizeFolderSync(
        isRunComplete && !flushFailure,
      )

      return flushFailure ?? syncFailure
    }

    if (!hasUncommittedBatches) {
      return flushFailure
    }

    const commitOutcome = await knowledge.commit({})

    if (commitOutcome.ok) {
      hasUncommittedBatches = false

      return flushFailure
    }

    return flushFailure ?? toFailure(commitOutcome.parsed)
  }

  async function processQueue(runState: RunState): Promise<void> {
    for (const key of runState.keys) {
      if (runState.controller.signal.aborted || isSuperseded(runState)) {
        return
      }

      const record = records.get(key)

      if (!record) {
        continue
      }

      publishProgress(runState, record.accepted.name)

      const outcome = await prepareEntry(record, runState.controller.signal)

      if (outcome.kind === 'cancelled') {
        return
      }

      if (outcome.kind === 'stop') {
        runState.stopFailure = outcome.failure

        return
      }

      runState.processed.add(key)
      publishProgress(runState, record.accepted.name)

      if (outcome.kind === 'settled') {
        continue
      }

      if (isBatchFull(runState.batch, outcome.item)) {
        const flushFailure = await flushBatch(runState.batch, false)

        if (flushFailure) {
          runState.processed.delete(key)
          updateEntry(key, { status: 'queued', error: null })
          runState.stopFailure = flushFailure

          return
        }
      }

      runState.batch.items.push(outcome.item)
      runState.batch.bytes += outcome.item.textBytes
    }
  }

  async function runQueue(): Promise<void> {
    const targetProjectId = resolvedProjectId.value

    if (!targetProjectId) {
      return
    }

    runToken += 1

    const keys = entries.value
      .filter(entry => entry.status === 'queued')
      .map(entry => entry.key)
    const runState: RunState = {
      token: runToken,
      projectId: targetProjectId,
      controller: new AbortController(),
      keys,
      processed: new Set<string>(),
      batch: { items: [], bytes: 0 },
      stopFailure: null,
    }

    activeRun = runState
    error.value = null
    wasCancelled.value = false
    phase.value = 'running'
    publishProgress(runState, null)

    await processQueue(runState)

    if (isSuperseded(runState)) {
      return
    }

    const isRunComplete = !runState.stopFailure
      && !runState.controller.signal.aborted
    const finalizeFailure = await finalizeRun(runState, isRunComplete)

    if (isSuperseded(runState)) {
      return
    }

    await knowledge.refresh()

    activeRun = null
    publishProgress(runState, null)
    wasCancelled.value = runState.controller.signal.aborted

    const failure = runState.stopFailure ?? finalizeFailure

    error.value = failure
    phase.value = failure ? 'error' : 'done'
  }

  async function start(): Promise<void> {
    if (
      phase.value !== 'preview'
      && phase.value !== 'error'
      && phase.value !== 'done'
    ) {
      return
    }

    await runQueue()
  }

  async function retryFailed(): Promise<void> {
    if (phase.value !== 'error' && phase.value !== 'done') {
      return
    }

    const failedKeys = entries.value
      .filter(entry => entry.status === 'failed')
      .map(entry => entry.key)

    if (failedKeys.length === 0) {
      return
    }

    for (const key of failedKeys) {
      updateEntry(key, { status: 'queued', error: null })
    }

    await runQueue()
  }

  function cancel(): void {
    if (phase.value !== 'running' || !activeRun) {
      return
    }

    activeRun.controller.abort()
    wasCancelled.value = true
  }

  function reset(): void {
    runToken += 1
    preparationToken += 1
    activeRun?.controller.abort()
    activeRun = null
    hasUncommittedBatches = false
    clearSession()
    phase.value = 'idle'
  }

  function dispose(): void {
    reset()
    extraction?.dispose()
    extraction = null
  }

  watch(resolvedProjectId, reset)

  if (getCurrentScope()) {
    onScopeDispose(dispose)
  }

  return {
    phase,
    plan,
    syncSummary,
    syncResult,
    entries,
    progress,
    error,
    wasCancelled,
    failedCount,
    isBusy,
    prepare,
    syncFolder,
    start,
    retryFailed,
    cancel,
    reset,
    dispose,
  }
}
