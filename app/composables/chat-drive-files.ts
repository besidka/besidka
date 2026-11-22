import type { ModelRef } from 'vue'
import { parseError } from 'evlog'
import type { FileMetadata } from '#shared/types/files.d'
import {
  GOOGLE_DRIVE_PICK_MAX,
  formatDriveGoogleDetail,
} from '#shared/utils/google-drive'
import type {
  DriveGoogleDetail,
  DriveImportFailureCode,
} from '#shared/utils/google-drive'
import {
  GOOGLE_DRIVE_LINKS_PER_MESSAGE_MAX,
  extractGoogleDriveLinks,
} from '#shared/utils/google-drive-links'
import type {
  GoogleDriveLinkKind,
  GoogleDriveLinkMatch,
} from '#shared/utils/google-drive-links'
import type { GoogleConnectionStatusResponse } from '#shared/utils/google-connections'
import type { AttachedFile } from '~/types/file-manager'
import { GOOGLE_CONNECTION_FETCH_KEY } from '~/composables/google-connection'
import type { PickedDriveItem } from '~/composables/google-picker'

export const GOOGLE_DRIVE_CONNECT_PATH = '/profile/keys?tab=google'
export const GOOGLE_DRIVE_CONNECT_SENTENCE
  = 'Connect Google Drive on the API Keys page to attach files from it.'
export const GOOGLE_DRIVE_BUSY_REASON
  = 'Google Drive files are still being copied. Wait a moment, then send.'

export const GOOGLE_LINK_REQUEST_TIMEOUT_MS = 15_000
export const GOOGLE_LINK_RUN_BUDGET_MS = 15_000
const UNREADABLE_LINKS_STATE_KEY = 'google-drive-unreadable-links'

const LINK_IMPORT_BLOCKING_STATUSES: ReadonlySet<number> = new Set([
  401,
  404,
  409,
  429,
])
const SILENT_LINK_FAILURE_CODES: ReadonlySet<DriveImportFailureCode>
  = new Set(['reauthorize', 'rate_limited', 'failed'])
const NO_ACCESS_LINK_FAILURE_CODES: ReadonlySet<DriveImportFailureCode>
  = new Set(['not_found', 'no_access'])

export interface DriveImportProgress {
  id: string
  name: string
  status: 'importing' | 'failed'
  error?: string
  code?: DriveImportFailureCode
  detail?: string
}

export interface DriveLinkSuggestion {
  id: string
  resourceKey?: string
  kind: GoogleDriveLinkKind
}

interface DriveAttachOptions {
  fileIds?: readonly string[]
}

interface QueuedLink {
  link: GoogleDriveLinkMatch
  startedGeneration: number
}

/**
 * Attaching files from Google Drive: asks the Picker for the user's files,
 * has the server copy them into Besidka's storage, and hands each copy to
 * `attach` (the composer's own rule for what the chosen model can read, and
 * how many it took), so a copy becomes a chip like an uploaded file.
 * `driveImports` is the progress and the per-file errors shown beside the
 * chips, and `isDriveBusy` tells the composer not to send while a pick or a
 * copy is in flight. A pick or copy that was started before the message was
 * sent, or before the composer was torn down, never attaches its result to
 * what comes next (a generation counter), and the Picker is not opened
 * again for a result nobody will use. The Google script is loaded only
 * inside `attachFromDrive()`.
 *
 * `pickAgain(id)` and `acceptLinkSuggestion(id)` open the Picker on that one
 * file, which is how a user grants Besidka access to a file it cannot read
 * (the `drive.file` permission cannot read a file from its link alone).
 * `detectLinks(text)` looks for Google Doc, Sheet, Slides and Drive file
 * links in the composer text (outside code) while Google Drive is active for
 * the user, `options.isAvailable` agrees (the menu row's own gates) and the
 * connection is active: for each new link (at most five a message, one
 * request at a time, only to Besidka's own link route, each request and the
 * whole run bounded to 15 seconds) Besidka copies the file when it can
 * already read it, and otherwise offers the Picker for that file as a
 * suggestion, remembered for the page session so the same link is not asked
 * about again. Nothing is shown for a link that fails for any other reason
 * than missing access. A copy that arrives after the message was sent is
 * deleted again. The composer awaits `detectLinks` when the user sends, so a
 * link typed and sent at once is still attached first.
 */
export function useChatDriveFiles(
  attachedFiles: ModelRef<FileMetadata[]>,
  attach: (files: AttachedFile[]) => number,
  options: { isAvailable?: () => boolean } = {},
) {
  const nuxtApp = useNuxtApp()
  const { ensureSendConsent } = useLegalConsent()
  const { pick, isCheckingConnection } = useGooglePicker()
  const { routeSlug } = useChatRoute()
  const { rememberChatGoogleData } = useChatGoogleData()
  const googleDriveFeature = useFeature('google.drive')
  const driveImports = ref<DriveImportProgress[]>([])
  const linkSuggestions = ref<DriveLinkSuggestion[]>([])
  const isPicking = shallowRef<boolean>(false)
  const isLinkProbing = shallowRef<boolean>(false)
  const connectionData
    = useNuxtData<GoogleConnectionStatusResponse>(GOOGLE_CONNECTION_FETCH_KEY)
  const unreadableLinks = useState<Record<string, DriveLinkSuggestion>>(
    UNREADABLE_LINKS_STATE_KEY,
    () => ({}),
  )
  const handledLinkIds = new Set<string>()
  const linkQueue: QueuedLink[] = []
  let linkRunner: Promise<void> | null = null
  let connectionRequest: Promise<boolean> | null = null
  let hasConnectionCheckFailed = false
  let isLinkImportBlocked = false
  let generation = 0

  const isDriveBusy = computed<boolean>(() => {
    return isPicking.value
      || isLinkProbing.value
      || driveImports.value.some((item) => {
        return item.status === 'importing'
      })
  })

  const importingCount = computed<number>(() => {
    return driveImports.value.filter((item) => {
      return item.status === 'importing'
    }).length
  })

  async function getMaxFilesPerMessage(): Promise<number> {
    const defaults = useRuntimeConfig().public

    try {
      const response = await $fetch('/api/v1/files/policy')

      return response.policy.maxFilesPerMessage
    } catch {
      return defaults.maxFilesPerMessage
    }
  }

  async function offerConnection() {
    const result = await useConfirm({
      text: GOOGLE_DRIVE_CONNECT_SENTENCE,
      actions: ['Open API Keys'],
      labelDecline: 'Not now',
    })

    if (result) {
      await navigateTo(GOOGLE_DRIVE_CONNECT_PATH)
    }
  }

  function setProgress(items: PickedDriveItem[]) {
    const pickedIds = new Set(items.map(item => item.id))

    driveImports.value = [
      ...driveImports.value.filter(item => !pickedIds.has(item.id)),
      ...items.map((item): DriveImportProgress => {
        return { id: item.id, name: item.name, status: 'importing' }
      }),
    ]
  }

  function removeProgress(id: string) {
    driveImports.value = driveImports.value.filter(item => item.id !== id)
  }

  function failProgress(
    id: string,
    error: string,
    extras: Pick<DriveImportProgress, 'code' | 'detail'> = {},
  ) {
    driveImports.value = driveImports.value.map((item) => {
      return item.id === id
        ? { ...item, status: 'failed', error, ...extras }
        : item
    })
  }

  function removeSuggestions(ids: readonly string[]) {
    linkSuggestions.value = linkSuggestions.value.filter((suggestion) => {
      return !ids.includes(suggestion.id)
    })
  }

  function requestImport(items: PickedDriveItem[]) {
    return $fetch('/api/v1/google/drive/files', {
      method: 'POST',
      body: {
        items: items.map((item) => {
          return {
            id: item.id,
            ...(item.resourceKey ? { resourceKey: item.resourceKey } : {}),
          }
        }),
      },
    })
  }

  function attachCopies(copies: AttachedFile[]) {
    if (copies.length === 0) {
      return
    }

    const existingKeys = new Set(attachedFiles.value.map((file) => {
      return file.storageKey
    }))
    const attachedCount = attach(copies.filter((copy) => {
      return !existingKeys.has(copy.storageKey)
    }))

    if (attachedCount === 0) {
      return
    }

    if (routeSlug.value) {
      rememberChatGoogleData(routeSlug.value, true)
    }

    nuxtApp.callHook('files:uploaded')
  }

  async function importPicked(
    items: PickedDriveItem[],
    startedGeneration: number,
  ) {
    setProgress(items)
    removeSuggestions(items.map(item => item.id))

    let response: Awaited<ReturnType<typeof requestImport>>

    try {
      response = await requestImport(items)
    } catch (exception) {
      if (generation !== startedGeneration) {
        return
      }

      const parsedException = parseError(exception)

      for (const item of items) {
        failProgress(
          item.id,
          parsedException.why || parsedException.message,
        )
      }

      useErrorMessage(
        parsedException.message || 'Google Drive files could not be copied',
        parsedException.why,
      )

      return
    }

    if (generation !== startedGeneration) {
      return
    }

    const copies: AttachedFile[] = []

    for (const result of response.results) {
      if (result.status === 'failed') {
        failProgress(result.id, result.reason, {
          code: result.code,
          detail: formatDriveGoogleDetail(result.google) ?? undefined,
        })

        continue
      }

      removeProgress(result.id)
      forgetUnreadable(result.id)
      copies.push(result.file)

      if (result.note) {
        useInfoMessage(result.note)
      }
    }

    attachCopies(copies)
  }

  async function runPick(
    startedGeneration: number,
    options: DriveAttachOptions,
  ) {
    if (!await ensureSendConsent(null)) {
      return
    }

    const maxFiles = await getMaxFilesPerMessage()
    const remainingSlots = maxFiles
      - attachedFiles.value.length
      - importingCount.value

    if (remainingSlots <= 0) {
      useErrorMessage(`You can attach a maximum of ${maxFiles} files in total.`)

      return
    }

    const result = await pick({
      maxItems: Math.min(remainingSlots, GOOGLE_DRIVE_PICK_MAX),
      ...(options.fileIds ? { fileIds: options.fileIds } : {}),
    })

    if (generation !== startedGeneration || result.status === 'canceled') {
      return
    }

    if (result.status === 'error') {
      if (result.code === 'not-connected' || result.code === 'reauthorize') {
        await offerConnection()

        return
      }

      useErrorMessage(result.message, result.why)

      return
    }

    for (const rejected of result.rejected) {
      useWarningMessage(
        `${rejected.name} could not be attached`,
        rejected.error,
      )
    }

    isPicking.value = false

    await importPicked(result.items, startedGeneration)
  }

  async function attachFromDrive(options: DriveAttachOptions = {}) {
    if (isDriveBusy.value) {
      return
    }

    isPicking.value = true

    try {
      await runPick(generation, options)
    } finally {
      isPicking.value = false
    }
  }

  async function pickAgain(id: string) {
    await attachFromDrive({ fileIds: [id] })
  }

  async function acceptLinkSuggestion(id: string) {
    await attachFromDrive({ fileIds: [id] })
  }

  function dismissLinkSuggestion(id: string) {
    removeSuggestions([id])
  }

  function isAlreadyAttached(id: string): boolean {
    const isCopyAttached = attachedFiles.value.some((file) => {
      return file.externalSource === 'google' && file.externalId === id
    })

    return isCopyAttached || driveImports.value.some((item) => {
      return item.id === id
    })
  }

  function showLinkFailureChip(
    link: GoogleDriveLinkMatch,
    result: { reason: string, code: DriveImportFailureCode },
    google: DriveGoogleDetail | undefined,
  ) {
    setProgress([{
      id: link.id,
      name: 'Google Drive file',
      mimeType: '',
    }])
    failProgress(link.id, result.reason, {
      code: result.code,
      detail: formatDriveGoogleDetail(google) ?? undefined,
    })
  }

  function toSuggestion(link: GoogleDriveLinkMatch): DriveLinkSuggestion {
    return {
      id: link.id,
      ...(link.resourceKey ? { resourceKey: link.resourceKey } : {}),
      kind: link.kind,
    }
  }

  function suggest(suggestion: DriveLinkSuggestion) {
    const isListed = linkSuggestions.value.some((listed) => {
      return listed.id === suggestion.id
    })

    if (!isListed) {
      linkSuggestions.value = [...linkSuggestions.value, suggestion]
    }
  }

  function forgetUnreadable(id: string) {
    if (unreadableLinks.value[id]) {
      unreadableLinks.value = Object.fromEntries(
        Object.entries(unreadableLinks.value).filter(([key]) => key !== id),
      )
    }
  }

  async function discardStaleCopy(
    result: { status: 'imported' | 'reused', file: { id: string } },
  ) {
    if (result.status !== 'imported') {
      return
    }

    try {
      await $fetch(`/api/v1/files/${result.file.id}`, { method: 'DELETE' })
    } catch {
      return
    }
  }

  async function probeLink(
    link: GoogleDriveLinkMatch,
    startedGeneration: number,
    timeout: number,
  ) {
    let response: Awaited<ReturnType<typeof requestLinkImport>>

    try {
      response = await requestLinkImport(link, timeout)
    } catch (exception) {
      const status = (exception as { status?: unknown }).status

      if (
        typeof status === 'number'
        && LINK_IMPORT_BLOCKING_STATUSES.has(status)
      ) {
        isLinkImportBlocked = true
      }

      return
    }

    const result = response.results[0]

    if (!result) {
      return
    }

    if (generation !== startedGeneration) {
      if (result.status !== 'failed') {
        await discardStaleCopy(result)
      }

      return
    }

    if (result.status !== 'failed') {
      attachCopies([result.file])

      if (result.note) {
        useInfoMessage(result.note)
      }

      return
    }

    if (NO_ACCESS_LINK_FAILURE_CODES.has(result.code)) {
      const suggestion = toSuggestion(link)

      unreadableLinks.value = {
        ...unreadableLinks.value,
        [link.id]: suggestion,
      }
      suggest(suggestion)

      return
    }

    if (!SILENT_LINK_FAILURE_CODES.has(result.code)) {
      showLinkFailureChip(link, result, result.google)
    }
  }

  function requestLinkImport(link: GoogleDriveLinkMatch, timeout: number) {
    return $fetch('/api/v1/google/drive/files/link', {
      method: 'POST',
      body: { link: link.url },
      timeout,
    })
  }

  async function processLinkQueue() {
    await Promise.resolve()

    const startedAt = Date.now()

    try {
      while (linkQueue.length > 0) {
        const queued = linkQueue.shift()
        const remaining = GOOGLE_LINK_RUN_BUDGET_MS - (Date.now() - startedAt)

        if (isLinkImportBlocked || remaining <= 0) {
          linkQueue.length = 0

          break
        }

        if (queued && queued.startedGeneration === generation) {
          isLinkProbing.value = true

          await probeLink(
            queued.link,
            queued.startedGeneration,
            Math.min(GOOGLE_LINK_REQUEST_TIMEOUT_MS, remaining),
          )
        }
      }
    } finally {
      linkRunner = null
      isLinkProbing.value = false
    }
  }

  function runLinkQueue(): Promise<void> {
    if (!linkRunner) {
      linkRunner = processLinkQueue()
    }

    return linkRunner
  }

  async function loadConnection(): Promise<boolean> {
    try {
      const response = await $fetch('/api/v1/google/connections')

      connectionData.data.value = response

      return isUsableConnection(response)
    } catch {
      hasConnectionCheckFailed = true

      return false
    } finally {
      connectionRequest = null
    }
  }

  function isUsableConnection(
    status: GoogleConnectionStatusResponse | null | undefined,
  ): boolean {
    const connection = status?.connection

    return connection?.status === 'active'
      && connection.capabilities.includes('drive-picked')
  }

  /**
   * Whether Google Drive is connected with an active connection, read from
   * the status the API Keys page keeps under the same fetch key. It is
   * requested from Besidka's own status route only when nothing is cached,
   * once, and again only after a failed answer on the next message; a
   * disconnect on the API Keys page refreshes that same entry. A link never
   * leaves the browser unless this is true.
   */
  async function isGoogleConnected(): Promise<boolean> {
    if (connectionData.data.value) {
      return isUsableConnection(connectionData.data.value)
    }

    if (hasConnectionCheckFailed) {
      return false
    }

    if (!connectionRequest) {
      connectionRequest = loadConnection()
    }

    return await connectionRequest
  }

  function isLinkDetectionAvailable(): boolean {
    return googleDriveFeature.value.active
      && (options.isAvailable?.() ?? true)
  }

  async function detectLinks(text: string) {
    if (!isLinkDetectionAvailable() || isLinkImportBlocked) {
      return
    }

    const candidates = extractGoogleDriveLinks(text).filter((link) => {
      return !handledLinkIds.has(link.id) && !isAlreadyAttached(link.id)
    })

    const startedGeneration = generation

    if (candidates.length === 0) {
      await linkRunner

      return
    }

    if (!await isGoogleConnected()) {
      return
    }

    if (generation !== startedGeneration) {
      return
    }

    for (const link of candidates) {
      if (handledLinkIds.size >= GOOGLE_DRIVE_LINKS_PER_MESSAGE_MAX) {
        break
      }

      handledLinkIds.add(link.id)

      const remembered = unreadableLinks.value[link.id]

      if (remembered) {
        suggest(remembered)

        continue
      }

      linkQueue.push({ link, startedGeneration })
    }

    if (linkQueue.length > 0) {
      await runLinkQueue()
    } else if (linkRunner) {
      await linkRunner
    }
  }

  function dismissDriveImport(id: string) {
    removeProgress(id)
  }

  function dismissAllDriveImports() {
    driveImports.value = []
  }

  function invalidatePendingWork() {
    generation++
    isPicking.value = false
    isLinkProbing.value = false
    isLinkImportBlocked = false
    hasConnectionCheckFailed = false
    handledLinkIds.clear()
    linkQueue.length = 0
    linkSuggestions.value = []
    dismissAllDriveImports()
  }

  nuxtApp.hook('chat:submit', invalidatePendingWork)

  if (getCurrentScope()) {
    onScopeDispose(invalidatePendingWork)
  }

  return {
    driveImports,
    linkSuggestions,
    importingCount,
    isDriveBusy,
    isCheckingGoogleConnection: isCheckingConnection,
    attachFromDrive,
    pickAgain,
    detectLinks,
    acceptLinkSuggestion,
    dismissLinkSuggestion,
    dismissDriveImport,
    dismissAllDriveImports,
  }
}
