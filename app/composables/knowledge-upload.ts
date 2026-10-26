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
import { parseKnowledgeRelativePath } from '#shared/utils/project-knowledge-path'
import { KNOWLEDGE_CONTENT_HASH_PATTERN } from '#shared/utils/project-knowledge-schemas'
import { normalizeKnowledgeTitle } from '~/utils/knowledge-title'
import { uploadWithProgress } from '~/utils/upload-with-progress'

interface UploadRecord {
  key: string
  accepted: KnowledgeAcceptedEntry
  fileId: string | null
  uploadedFileId: string | null
  isSending: boolean
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
  contentHash: string
  replacedByKey: string | null
  hasKnownHash: boolean
}

interface SyncState {
  removals: SyncRemoval[]
  addKeys: Set<string>
  addHashByKey: Map<string, string>
  unchanged: number
  foreignFolderItems: number
  keptIneligible: number
  isTruncated: boolean
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

interface SettledItem {
  item: PreparedItem
  outcome: 'created' | 'duplicate' | 'failed'
  message: string | null
}

interface SendResult {
  settled: SettledItem[]
  failure: KnowledgeUploadFailure | null
  hasCommitted: boolean
}

type PrepareOutcome
  = | { kind: 'item', item: PreparedItem }
    | { kind: 'settled' }
    | { kind: 'cancelled' }
    | { kind: 'stop', failure: KnowledgeUploadFailure }

const MAX_BATCH_ITEMS = 25

const MAX_UNLINKED_UPLOAD_BYTES = 10 * 1024 * 1024

const RUN_STOPPING_STATUSES: ReadonlySet<number> = new Set([402, 413, 422, 429])

const STORAGE_MESSAGE_PATTERN = /storage|quota/i

const FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

const CREATED_STATUSES: readonly KnowledgeUploadEntryStatus[] = [
  'ready',
  'no-text',
]

const CONFLICT_STATUS = 409

const IOS_UPDATE_REQUIRED_ERROR = 'ios-update-required'

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

  return parseKnowledgeRelativePath(relativePath)
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
  if (KNOWLEDGE_CONTENT_HASH_PATTERN.test(extractedHash)) {
    return extractedHash
  }

  return KNOWLEDGE_CONTENT_HASH_PATTERN.test(plannedHash) ? plannedHash : null
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

function isNativePdfFallback(extracted: KnowledgeExtractionResult): boolean {
  return extracted.extractStatus === 'failed'
    && extracted.extractError === IOS_UPDATE_REQUIRED_ERROR
    && extracted.needsOriginalUpload
}

function knowledgeCommitUrl(projectId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/knowledge/commit`
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
  const cleanupFailures = shallowRef<number>(0)
  const hasPendingCommit = shallowRef<boolean>(false)
  const isRetryingCommit = shallowRef<boolean>(false)

  let records = new Map<string, UploadRecord>()
  let context: RunContext = {
    folderId: null,
    commitWithLastBatch: true,
    sync: null,
  }
  let uncommittedProjectId: string | null = null
  let wasLastRunComplete = false
  let sessionToken = 0
  let activeRun: RunState | null = null
  let extraction: ReturnType<typeof useKnowledgeExtraction> | null = null
  let runToken = 0
  let preparationToken = 0

  const failedCount = computed<number>(() => {
    return entries.value.filter(entry => entry.status === 'failed').length
  })

  const canRetryCommit = computed<boolean>(() => {
    const isFinished = phase.value === 'error' || phase.value === 'done'

    return isFinished
      && hasPendingCommit.value
      && failedCount.value === 0
      && !isRetryingCommit.value
  })

  const isBusy = computed<boolean>(() => {
    return phase.value === 'planning'
      || phase.value === 'running'
      || isRetryingCommit.value
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

  function markUncommitted(targetProjectId: string): void {
    uncommittedProjectId = targetProjectId
    hasPendingCommit.value = true
  }

  function markCommitted(): void {
    uncommittedProjectId = null
    hasPendingCommit.value = false
  }

  async function commitInBackground(targetProjectId: string): Promise<void> {
    try {
      await $fetch(knowledgeCommitUrl(targetProjectId), {
        method: 'POST',
        body: {},
      })
    } catch {
      return
    }
  }

  async function deleteUploadedFile(fileId: string): Promise<boolean> {
    try {
      await $fetch(`/api/v1/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
      })

      return true
    } catch {
      return false
    }
  }

  async function deleteFilesInBackground(fileIds: string[]): Promise<void> {
    for (const fileId of fileIds) {
      await deleteUploadedFile(fileId)
    }
  }

  async function removeUnlinkedUpload(
    record: UploadRecord,
    shouldCountFailure: boolean,
  ): Promise<void> {
    const { uploadedFileId } = record

    if (!uploadedFileId) {
      return
    }

    record.uploadedFileId = null
    record.fileId = null

    const isDeleted = await deleteUploadedFile(uploadedFileId)

    if (!isDeleted && shouldCountFailure) {
      cleanupFailures.value += 1
    }
  }

  function releaseSession(): void {
    const projectIdToCommit = uncommittedProjectId
    const orphanedFileIds: string[] = []

    for (const record of records.values()) {
      if (record.uploadedFileId && !record.isSending) {
        orphanedFileIds.push(record.uploadedFileId)
        record.uploadedFileId = null
      }
    }

    sessionToken += 1
    markCommitted()

    if (projectIdToCommit) {
      commitInBackground(projectIdToCommit)
    }

    if (orphanedFileIds.length > 0) {
      deleteFilesInBackground(orphanedFileIds)
    }
  }

  function clearSession(): void {
    releaseSession()
    cleanupFailures.value = 0
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
        uploadedFileId: null,
        isSending: false,
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
        const isTruncated = input.truncated === true
        const diff = diffFolderSync({
          existing: input.existing.filter((item) => {
            return !foreignFolderItems.includes(item)
          }),
          incoming: incomingWithPaths,
          walkedPaths: input.walkedPaths,
          truncated: isTruncated,
        })
        const queued = [
          ...diff.add,
          ...diff.replace.map(replacement => replacement.incoming),
        ]
        const keyByAccepted = registerAccepted(
          queued,
          collectFileIds(input.incoming),
        )
        const storedHashById = new Map<string, string>(
          input.existing.map(item => [item.id, item.contentHash]),
        )
        const removals: SyncRemoval[] = diff.remove.map((itemId) => {
          return {
            itemId,
            contentHash: storedHashById.get(itemId) ?? '',
            replacedByKey: null,
            hasKnownHash: false,
          }
        })

        for (const replacement of diff.replace) {
          removals.push({
            itemId: replacement.itemId,
            contentHash: storedHashById.get(replacement.itemId) ?? '',
            replacedByKey: keyByAccepted.get(replacement.incoming) ?? null,
            hasKnownHash: replacement.hasKnownHash,
          })
        }

        const sync: SyncState = {
          removals,
          addKeys: new Set<string>(
            diff.add.flatMap(entry => keyByAccepted.get(entry) ?? []),
          ),
          addHashByKey: new Map<string, string>(
            diff.add.flatMap((entry) => {
              const key = keyByAccepted.get(entry)

              return key ? [[key, entry.contentHash] as const] : []
            }),
          ),
          unchanged: diff.unchanged,
          foreignFolderItems: foreignFolderItems.length,
          keptIneligible: diff.kept.length,
          isTruncated,
          removed: 0,
          couldNotRemove: 0,
        }

        context = {
          folderId: input.folderId,
          commitWithLastBatch: false,
          sync,
        }
        plan.value = summarizeKnowledgePlan(knowledgePlan)
        syncSummary.value = {
          added: diff.add.length,
          replaced: diff.replace.length,
          removed: diff.remove.length,
          unchanged: diff.unchanged,
          notices: describePlanNotices(sync),
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

  function willExceedUnlinkedUploadBudget(
    record: UploadRecord,
    runState: RunState,
  ): boolean {
    const pendingBytes = runState.batch.items.reduce((total, item) => {
      const pendingRecord = records.get(item.key)

      return pendingRecord?.uploadedFileId
        ? total + pendingRecord.accepted.file.size
        : total
    }, 0)

    return pendingBytes > 0
      && pendingBytes + record.accepted.file.size > MAX_UNLINKED_UPLOAD_BYTES
  }

  async function prepareEntry(
    record: UploadRecord,
    runState: RunState,
  ): Promise<PrepareOutcome> {
    const { key, accepted } = record
    const { signal } = runState.controller

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

    if (extracted.extractStatus === 'failed' && !isNativePdfFallback(extracted)) {
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
      if (willExceedUnlinkedUploadBudget(record, runState)) {
        const flushFailure = await flushBatch(
          runState.batch,
          false,
          runState.projectId,
        )

        if (flushFailure) {
          updateEntry(key, { status: 'queued', error: null })

          return { kind: 'stop', failure: flushFailure }
        }
      }

      updateEntry(key, { status: 'uploading-original' })

      try {
        const uploadedFileId = await uploadOriginal(record, extracted, signal)

        record.fileId = uploadedFileId
        record.uploadedFileId = uploadedFileId
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

      if (isSuperseded(runState)) {
        await removeUnlinkedUpload(record, false)

        return { kind: 'cancelled' }
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

  function settleBatchResult(
    sentItems: PreparedItem[],
    skippedIndexes: Set<number>,
  ): SettledItem[] {
    return sentItems.map((item, index) => {
      return {
        item,
        outcome: skippedIndexes.has(index) ? 'duplicate' : 'created',
        message: null,
      }
    })
  }

  function failSettled(
    sentItems: PreparedItem[],
    message: string,
  ): SettledItem[] {
    return sentItems.map((item) => {
      return { item, outcome: 'failed', message }
    })
  }

  async function sendItemsOneByOne(
    sentItems: PreparedItem[],
  ): Promise<SendResult> {
    const settled: SettledItem[] = []

    for (const [index, item] of sentItems.entries()) {
      const outcome = await knowledge.addItems([item.payload], {
        commit: false,
      })

      if (outcome.ok) {
        settled.push(...settleBatchResult(
          [item],
          new Set<number>(outcome.result.skipped.map(skipped => skipped.index)),
        ))

        continue
      }

      const failure = toFailure(outcome.parsed)

      if (outcome.parsed.status === CONFLICT_STATUS) {
        settled.push(...failSettled([item], failure.message))

        continue
      }

      settled.push(...failSettled(sentItems.slice(index), failure.message))

      return { settled, failure, hasCommitted: false }
    }

    return { settled, failure: null, hasCommitted: false }
  }

  async function sendItems(
    sentItems: PreparedItem[],
    commit: boolean,
  ): Promise<SendResult> {
    const outcome = await knowledge.addItems(
      sentItems.map(item => item.payload),
      { commit },
    )

    if (outcome.ok) {
      return {
        settled: settleBatchResult(
          sentItems,
          new Set<number>(outcome.result.skipped.map(skipped => skipped.index)),
        ),
        failure: null,
        hasCommitted: commit,
      }
    }

    if (outcome.parsed.status === CONFLICT_STATUS && sentItems.length > 1) {
      return sendItemsOneByOne(sentItems)
    }

    const failure = toFailure(outcome.parsed)

    return {
      settled: failSettled(sentItems, failure.message),
      failure: outcome.parsed.status === CONFLICT_STATUS ? null : failure,
      hasCommitted: false,
    }
  }

  function applySettled(settled: SettledItem[]): void {
    const settledByKey = new Map<string, SettledItem>(
      settled.map(entry => [entry.item.key, entry]),
    )

    entries.value = entries.value.map((entry) => {
      const settledItem = settledByKey.get(entry.key)

      if (!settledItem) {
        return entry
      }

      if (settledItem.outcome === 'failed') {
        return { ...entry, status: 'failed', error: settledItem.message }
      }

      if (settledItem.outcome === 'duplicate') {
        return { ...entry, status: 'skipped-duplicate', error: null }
      }

      const status: KnowledgeUploadEntryStatus
        = settledItem.item.payload.extractStatus === 'no-text'
          ? 'no-text'
          : 'ready'

      return { ...entry, status, error: null }
    })
  }

  async function flushBatch(
    batch: PendingBatch,
    commit: boolean,
    targetProjectId: string,
  ): Promise<KnowledgeUploadFailure | null> {
    if (batch.items.length === 0) {
      return null
    }

    const sentItems = batch.items
    const sentRecords = sentItems.flatMap((item) => {
      return records.get(item.key) ?? []
    })
    const recordByKey = new Map<string, UploadRecord>(
      sentRecords.map(record => [record.key, record]),
    )
    const sessionAtStart = sessionToken

    batch.items = []
    batch.bytes = 0

    for (const record of sentRecords) {
      record.isSending = true
    }

    const { settled, failure, hasCommitted } = await sendItems(
      sentItems,
      commit,
    )
    const isSessionCurrent = sessionAtStart === sessionToken
    const hasCreated = settled.some(entry => entry.outcome === 'created')

    for (const record of sentRecords) {
      record.isSending = false
    }

    for (const entry of settled) {
      const record = recordByKey.get(entry.item.key)

      if (!record) {
        continue
      }

      if (entry.outcome === 'created') {
        record.uploadedFileId = null
      } else if (entry.outcome === 'duplicate' || !isSessionCurrent) {
        await removeUnlinkedUpload(record, isSessionCurrent)
      }
    }

    if (!isSessionCurrent) {
      if (hasCreated && !hasCommitted) {
        commitInBackground(targetProjectId)
      }

      return failure
    }

    applySettled(settled)

    if (hasCommitted) {
      markCommitted()
    } else if (hasCreated) {
      markUncommitted(targetProjectId)
    }

    return failure
  }

  function getEntryStatus(key: string): KnowledgeUploadEntryStatus | null {
    return entries.value.find(entry => entry.key === key)?.status ?? null
  }

  function planRemovals(sync: SyncState, isRunComplete: boolean): RemovalPlan {
    const skippedAddKeys = Array.from(sync.addKeys).filter((key) => {
      return getEntryStatus(key) === 'skipped-duplicate'
    })
    const skippedAddHashes = new Set<string>(
      skippedAddKeys.flatMap(key => sync.addHashByKey.get(key) ?? []),
    )
    const removalPlan: RemovalPlan = {
      removableIds: [],
      keptRenamed: 0,
      keptReplaced: 0,
      unchangedUnknown: 0,
    }

    for (const removal of sync.removals) {
      if (removal.replacedByKey === null) {
        if (!isRunComplete || sync.isTruncated) {
          continue
        }

        const isRenameSuspect = removal.contentHash.length > 0
          ? skippedAddHashes.has(removal.contentHash)
          : skippedAddKeys.length > 0

        if (isRenameSuspect) {
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

  function describePlanNotices(sync: SyncState): string[] {
    const notices: string[] = []

    if (sync.keptIneligible > 0) {
      const count = sync.keptIneligible

      notices.push(
        `${count} ${pluralize(count, 'file is', 'files are')} no longer `
        + `eligible and ${pluralize(count, 'was', 'were')} kept.`,
      )
    }

    if (sync.isTruncated) {
      notices.push(
        'Your folder has more files than were read, so nothing was removed.',
      )
    }

    return notices
  }

  function describeSyncNotices(
    sync: SyncState,
    removalPlan: RemovalPlan,
  ): string[] {
    const notices: string[] = describePlanNotices(sync)

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
      cleanupFailures: cleanupFailures.value,
      notices: describeSyncNotices(sync, removalPlan),
    }
  }

  async function finalizeFolderSync(
    isRunComplete: boolean,
    targetProjectId: string,
  ): Promise<KnowledgeUploadFailure | null> {
    const sync = context.sync

    if (!sync) {
      return null
    }

    const removalPlan = planRemovals(sync, isRunComplete)
    const { removableIds } = removalPlan
    let failure: KnowledgeUploadFailure | null = null

    if (uncommittedProjectId !== null || removableIds.length > 0) {
      const body: KnowledgeCommitInput = removableIds.length > 0
        ? { folderId: context.folderId, remove: removableIds }
        : {}
      const outcome = await knowledge.commit(body)

      if (outcome.ok) {
        const skippedIds = new Set<string>(outcome.result.skipped)
        const skippedCount = removableIds.filter((itemId) => {
          return skippedIds.has(itemId)
        }).length

        sync.removed += outcome.result.removed
        sync.couldNotRemove += skippedCount
        sync.removals = sync.removals.filter((removal) => {
          return !removableIds.includes(removal.itemId)
        })
        markCommitted()
      } else {
        failure = toFailure(outcome.parsed)
        markUncommitted(targetProjectId)
      }
    }

    publishSyncResult(sync, removalPlan)

    return failure
  }

  async function commitPendingBatches(): Promise<
    KnowledgeUploadFailure | null
  > {
    if (uncommittedProjectId === null) {
      return null
    }

    const commitOutcome = await knowledge.commit({})

    if (commitOutcome.ok) {
      markCommitted()

      return null
    }

    return toFailure(commitOutcome.parsed)
  }

  async function finalizeRun(
    runState: RunState,
    isRunComplete: boolean,
  ): Promise<KnowledgeUploadFailure | null> {
    const flushFailure = await flushBatch(
      runState.batch,
      context.commitWithLastBatch,
      runState.projectId,
    )

    wasLastRunComplete = isRunComplete && !flushFailure

    if (!context.commitWithLastBatch) {
      const syncFailure = await finalizeFolderSync(
        wasLastRunComplete,
        runState.projectId,
      )

      return flushFailure ?? syncFailure
    }

    const commitFailure = await commitPendingBatches()

    return flushFailure ?? commitFailure
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

      const outcome = await prepareEntry(record, runState)

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
        const flushFailure = await flushBatch(
          runState.batch,
          false,
          runState.projectId,
        )

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

  async function retryCommit(): Promise<void> {
    const isFinished = phase.value === 'error' || phase.value === 'done'

    const pendingProjectId = uncommittedProjectId

    if (
      !isFinished
      || !pendingProjectId
      || isRetryingCommit.value
    ) {
      return
    }

    const sessionAtStart = sessionToken

    isRetryingCommit.value = true

    const failure = context.sync
      ? await finalizeFolderSync(wasLastRunComplete, pendingProjectId)
      : await commitPendingBatches()

    isRetryingCommit.value = false

    if (sessionAtStart !== sessionToken) {
      return
    }

    await knowledge.refresh()

    error.value = failure
    phase.value = failure ? 'error' : 'done'
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
    cleanupFailures,
    failedCount,
    canRetryCommit,
    isBusy,
    prepare,
    syncFolder,
    start,
    retryFailed,
    retryCommit,
    cancel,
    reset,
    dispose,
  }
}
