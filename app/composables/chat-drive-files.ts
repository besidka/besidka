import type { ModelRef } from 'vue'
import { parseError } from 'evlog'
import type { FileMetadata } from '#shared/types/files.d'
import { GOOGLE_DRIVE_PICK_MAX } from '#shared/utils/google-drive'
import type { AttachedFile } from '~/types/file-manager'
import type { PickedDriveItem } from '~/composables/google-picker'

export const GOOGLE_DRIVE_CONNECT_PATH = '/profile/keys?tab=google'
export const GOOGLE_DRIVE_CONNECT_SENTENCE
  = 'Connect Google Drive on the API Keys page to attach files from it.'
export const GOOGLE_DRIVE_BUSY_REASON
  = 'Google Drive files are still being copied. Wait a moment, then send.'

export interface DriveImportProgress {
  id: string
  name: string
  status: 'importing' | 'failed'
  error?: string
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
 */
export function useChatDriveFiles(
  attachedFiles: ModelRef<FileMetadata[]>,
  attach: (files: AttachedFile[]) => number,
) {
  const nuxtApp = useNuxtApp()
  const { ensureSendConsent } = useLegalConsent()
  const { pick } = useGooglePicker()
  const { routeSlug } = useChatRoute()
  const { rememberChatGoogleData } = useChatGoogleData()
  const driveImports = ref<DriveImportProgress[]>([])
  const isPicking = shallowRef<boolean>(false)
  let generation = 0

  const isDriveBusy = computed<boolean>(() => {
    return isPicking.value || driveImports.value.some((item) => {
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

  function failProgress(id: string, error: string) {
    driveImports.value = driveImports.value.map((item) => {
      return item.id === id ? { ...item, status: 'failed', error } : item
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

  async function importPicked(
    items: PickedDriveItem[],
    startedGeneration: number,
  ) {
    setProgress(items)

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
        const name = items.find(item => item.id === result.id)?.name

        failProgress(result.id, result.reason)
        useWarningMessage(
          `${name ?? 'A Google Drive file'} could not be attached`,
          result.reason,
        )

        continue
      }

      removeProgress(result.id)
      copies.push(result.file)

      if (result.note) {
        useInfoMessage(result.note)
      }
    }

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

  async function runPick(startedGeneration: number) {
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

  async function attachFromDrive() {
    if (isDriveBusy.value) {
      return
    }

    isPicking.value = true

    try {
      await runPick(generation)
    } finally {
      isPicking.value = false
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
    dismissAllDriveImports()
  }

  nuxtApp.hook('chat:submit', invalidatePendingWork)

  if (getCurrentScope()) {
    onScopeDispose(invalidatePendingWork)
  }

  return {
    driveImports,
    importingCount,
    isDriveBusy,
    attachFromDrive,
    dismissDriveImport,
    dismissAllDriveImports,
  }
}
