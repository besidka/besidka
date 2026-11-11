import type { MaybeRefOrGetter } from 'vue'
import type {
  DocumentFileRef,
  DocumentStatus,
  DocumentStatusResponse,
} from '#shared/utils/documents'
import { collectImageIds } from '@besidka/doc-renderer/spec'
import type { DocumentSpec } from '@besidka/doc-renderer/spec'
import { parseError } from 'evlog'
import { getDocumentErrorCodeMessage } from '~/utils/document-ui'
import {
  DOCUMENT_ERROR_CODES,
  DOCUMENT_FORMAT_HEADER,
  DOCUMENT_POLL_INTERVAL_MS,
  DOCUMENT_POLL_TIMEOUT_MS,
  isDocumentFormat,
  isDocumentStatus,
} from '#shared/utils/documents'

export type DocumentFlowStatus = DocumentStatus | 'loading' | 'unavailable'

export interface DocumentFlowOptions {
  isStreaming: MaybeRefOrGetter<boolean>
  modelId?: MaybeRefOrGetter<string | undefined>
}

export interface DocumentFileUrls {
  downloadUrl: string
  viewUrl: string
}

type StatusFetchResult = DocumentStatusResponse | 'unavailable' | 'error'
type PollOutcome = 'settled' | 'stuck' | 'cancelled'
type ClientRenderOutcome = 'uploaded' | 'skipped'

const CONFLICT_STATUS = 409
const SERVER_FALLBACK_BLOCKED_STATUSES: readonly number[] = [507, 429, 413]
const UNAVAILABLE_STATUSES: readonly number[] = [403, 404]
const DEFAULT_ERROR_MESSAGE = 'The document could not be created.'
const STUCK_ERROR_MESSAGE
  = 'Building this document is taking longer than expected.'

const documentsInFlight = new Set<string>()

const errorMessages: Record<string, string> = {
  [DOCUMENT_ERROR_CODES.quotaExceeded]:
    'There is not enough storage left for this document.',
  [DOCUMENT_ERROR_CODES.rendererUnavailable]:
    'Document rendering is unavailable right now.',
}

export function getDocumentErrorMessage(code: string | null): string {
  if (!code) {
    return DEFAULT_ERROR_MESSAGE
  }

  return getDocumentErrorCodeMessage(code)
    || errorMessages[code]
    || DEFAULT_ERROR_MESSAGE
}

export function getDocumentFileUrls(file: DocumentFileRef): DocumentFileUrls {
  return {
    downloadUrl: `/files/${file.storageKey}?download=1`,
    viewUrl: `/files/${file.storageKey}`,
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readStatusResponse(payload: unknown): DocumentStatusResponse | null {
  const record = readRecord(payload)

  if (
    !record
    || typeof record.id !== 'string'
    || !isDocumentFormat(record.format)
    || !isDocumentStatus(record.status)
  ) {
    return null
  }

  return record as unknown as DocumentStatusResponse
}

function hasImageBlocks(spec: unknown): boolean {
  try {
    return collectImageIds(spec as DocumentSpec).length > 0
  } catch (_exception) {
    return false
  }
}

function readSpecPayload(payload: unknown): unknown {
  const record = readRecord(payload)

  return readRecord(record?.spec) ?? payload
}

/**
 * Drives one document card from its persisted status to a downloadable file:
 * reads the status, renders the spec in the browser Worker once the message
 * stopped streaming, uploads the bytes, falls back to the server renderer
 * once, and polls while a render is in progress. A document id that another
 * card of this tab already renders is only polled.
 */
export function useDocumentFlow(
  documentId: MaybeRefOrGetter<string | null>,
  options: DocumentFlowOptions,
) {
  const documentRender = useDocumentRender()

  const status = shallowRef<DocumentFlowStatus>('loading')
  const document = shallowRef<DocumentStatusResponse | null>(null)
  const errorMessage = shallowRef<string>('')
  const isBusy = shallowRef<boolean>(false)
  const hasTimedOut = shallowRef<boolean>(false)

  const fileUrls = computed<DocumentFileUrls | null>(() => {
    return document.value?.file
      ? getDocumentFileUrls(document.value.file)
      : null
  })

  let generation: number = 0
  let hasAutoAttempted: boolean = false
  let isUploading: boolean = false
  let waitTimeoutId: ReturnType<typeof setTimeout> | null = null
  let cancelWait: (() => void) | null = null

  function isCurrent(run: number): boolean {
    return run === generation
  }

  function wait(delayMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      waitTimeoutId = setTimeout(() => {
        waitTimeoutId = null
        cancelWait = null
        resolve(true)
      }, delayMs)
      cancelWait = () => {
        if (waitTimeoutId !== null) {
          clearTimeout(waitTimeoutId)
        }

        waitTimeoutId = null
        cancelWait = null
        resolve(false)
      }
    })
  }

  function applyStatus(response: DocumentStatusResponse): void {
    document.value = response
    status.value = response.status
    errorMessage.value = response.status === 'failed'
      ? getDocumentErrorMessage(response.errorCode)
      : ''
  }

  function markUnavailable(message: string): void {
    status.value = 'unavailable'
    errorMessage.value = message
  }

  function markFailed(exception: unknown): void {
    status.value = 'failed'
    errorMessage.value = parseError(exception).message
      || DEFAULT_ERROR_MESSAGE
  }

  async function fetchStatus(
    id: string,
    run: number,
  ): Promise<StatusFetchResult> {
    try {
      const payload = await $fetch(`/api/v1/documents/${id}`)
      const response = readStatusResponse(payload)

      if (!response) {
        return 'error'
      }

      if (isCurrent(run)) {
        applyStatus(response)
      }

      return response
    } catch (exception) {
      const parsedException = parseError(exception)

      if (!isCurrent(run)) {
        return 'error'
      }

      if (UNAVAILABLE_STATUSES.includes(parsedException.status)) {
        markUnavailable('This document is no longer available.')

        return 'unavailable'
      }

      errorMessage.value = parsedException.message || DEFAULT_ERROR_MESSAGE

      return 'error'
    }
  }

  async function poll(
    id: string,
    run: number,
    isWaitingForPeer: boolean,
  ): Promise<PollOutcome> {
    const startedAt = Date.now()

    while (true) {
      const shouldContinue = await wait(DOCUMENT_POLL_INTERVAL_MS)

      if (!shouldContinue || !isCurrent(run)) {
        return 'cancelled'
      }

      const result = await fetchStatus(id, run)

      if (!isCurrent(run)) {
        return 'cancelled'
      }

      if (result === 'unavailable') {
        return 'settled'
      }

      if (result !== 'error') {
        const isPeerPending = isWaitingForPeer
          && documentsInFlight.has(id)
          && result.status === 'spec_ready'

        if (isPeerPending) {
          status.value = 'rendering'
        }

        if (result.status === 'spec_ready' && !isPeerPending) {
          return 'stuck'
        }

        if (result.status !== 'rendering' && !isPeerPending) {
          return 'settled'
        }
      }

      if (Date.now() - startedAt >= DOCUMENT_POLL_TIMEOUT_MS) {
        hasTimedOut.value = true

        return 'stuck'
      }
    }
  }

  function markStuck(): void {
    status.value = 'failed'
    errorMessage.value = STUCK_ERROR_MESSAGE
  }

  async function pollUntilSettled(
    id: string,
    run: number,
    isWaitingForPeer: boolean,
  ): Promise<void> {
    const outcome = await poll(id, run, isWaitingForPeer)

    if (outcome !== 'stuck' || !isCurrent(run)) {
      return
    }

    const current = document.value
    const canAttemptOnce = !hasAutoAttempted
      && current !== null
      && !toValue(options.isStreaming)
      && import.meta.client

    if (!canAttemptOnce) {
      markStuck()

      return
    }

    hasAutoAttempted = true
    hasTimedOut.value = false

    await attemptRender(id, current, run)
  }

  async function uploadClientRender(
    id: string,
    format: DocumentStatusResponse['format'],
  ): Promise<ClientRenderOutcome> {
    const specPayload = await $fetch(`/api/v1/documents/${id}/spec`)
    const spec = readSpecPayload(specPayload)

    if (hasImageBlocks(spec)) {
      return 'skipped'
    }

    const output = await documentRender.render({
      spec,
      modelId: toValue(options.modelId),
    })

    await $fetch(`/api/v1/documents/${id}/file`, {
      method: 'POST',
      body: output.bytes,
      headers: {
        'Content-Type': 'application/octet-stream',
        [DOCUMENT_FORMAT_HEADER]: format,
      },
    })

    return 'uploaded'
  }

  async function requestServerRender(
    id: string,
    run: number,
  ): Promise<'accepted' | 'peer' | 'failed'> {
    try {
      await $fetch(`/api/v1/documents/${id}/render`, {
        method: 'POST',
        body: {},
      })

      return 'accepted'
    } catch (exception) {
      if (parseError(exception).status === CONFLICT_STATUS) {
        return 'peer'
      }

      if (isCurrent(run)) {
        markFailed(exception)
      }

      return 'failed'
    }
  }

  async function attemptRender(
    id: string,
    current: DocumentStatusResponse,
    run: number,
  ): Promise<void> {
    if (documentsInFlight.has(id)) {
      status.value = 'rendering'
      await pollUntilSettled(id, run, true)

      return
    }

    documentsInFlight.add(id)
    hasAutoAttempted = true
    status.value = 'rendering'

    let isPeerRendering = false
    let hasClientFailed = false
    let blockedException: unknown = null

    isUploading = true

    try {
      const outcome = await uploadClientRender(id, current.format)

      hasClientFailed = outcome === 'skipped'
    } catch (exception) {
      const failureStatus = parseError(exception).status

      isPeerRendering = failureStatus === CONFLICT_STATUS

      if (SERVER_FALLBACK_BLOCKED_STATUSES.includes(failureStatus)) {
        blockedException = exception
      } else {
        hasClientFailed = !isPeerRendering
      }
    } finally {
      isUploading = false
      documentsInFlight.delete(id)
    }

    if (!isCurrent(run)) {
      return
    }

    if (blockedException) {
      markFailed(blockedException)

      return
    }

    if (hasClientFailed) {
      const outcome = await requestServerRender(id, run)

      if (outcome === 'failed' || !isCurrent(run)) {
        return
      }

      isPeerRendering = outcome === 'peer'
    }

    const refreshed = await fetchStatus(id, run)

    const isRefreshFailure = refreshed === 'unavailable'
      || refreshed === 'error'

    if (!isCurrent(run) || isRefreshFailure) {
      return
    }

    if (refreshed.status === 'rendering' || isPeerRendering) {
      await pollUntilSettled(id, run, false)
    }
  }

  async function continueFromStatus(
    id: string,
    current: DocumentStatusResponse,
    run: number,
    isRetry: boolean,
  ): Promise<void> {
    if (current.status === 'ready') {
      return
    }

    if (current.status === 'rendering' && !isRetry) {
      await pollUntilSettled(id, run, false)

      return
    }

    const canAttempt = isRetry || (
      current.status === 'spec_ready' && !hasAutoAttempted
    )

    if (!canAttempt || toValue(options.isStreaming) || !import.meta.client) {
      return
    }

    await attemptRender(id, current, run)
  }

  async function load(isRetry: boolean): Promise<void> {
    generation += 1

    const run = generation
    const id = toValue(documentId)

    cancelWait?.()
    hasTimedOut.value = false

    if (!id) {
      markUnavailable('')

      return
    }

    if (!import.meta.client) {
      return
    }

    isBusy.value = true

    try {
      const result = await fetchStatus(id, run)

      if (!isCurrent(run)) {
        return
      }

      if (result === 'error') {
        status.value = 'unavailable'

        return
      }

      if (result === 'unavailable') {
        return
      }

      await continueFromStatus(id, result, run, isRetry)
    } finally {
      if (isCurrent(run)) {
        isBusy.value = false
      }
    }
  }

  function refresh(): Promise<void> {
    return load(false)
  }

  async function retry(): Promise<void> {
    if (toValue(options.isStreaming)) {
      return
    }

    await load(true)
  }

  if (import.meta.client) {
    watch(
      [() => toValue(documentId), () => toValue(options.isStreaming)],
      ([id, isStreaming], [previousId]) => {
        if (id !== previousId) {
          hasAutoAttempted = false
          status.value = 'loading'
          document.value = null
          errorMessage.value = ''
          load(false)

          return
        }

        const isSettled = status.value === 'ready'
          || status.value === 'unavailable'

        if (!isStreaming && !isSettled && !isUploading) {
          load(false)
        }
      },
      { immediate: true },
    )
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      generation += 1
      cancelWait?.()
    })
  }

  return {
    status,
    document,
    errorMessage,
    isBusy,
    hasTimedOut,
    fileUrls,
    retry,
    refresh,
  }
}
