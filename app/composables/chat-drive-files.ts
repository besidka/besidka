import type { ModelRef } from 'vue'
import { parseError } from 'evlog'
import type { FileMetadata } from '#shared/types/files.d'
import { GOOGLE_DRIVE_PICK_MAX } from '#shared/utils/google-drive'
import type { AttachedFile } from '~/types/file-manager'
import type { PickedDriveItem } from '~/composables/google-picker'

export const GOOGLE_DRIVE_CONNECT_PATH = '/profile/keys?tab=google'
export const GOOGLE_DRIVE_CONNECT_SENTENCE
  = 'Connect Google Drive on the API Keys page to attach files from it.'

export interface DriveImportProgress {
  id: string
  name: string
  status: 'importing' | 'failed'
  error?: string
}

/**
 * Attaching files from Google Drive: asks the Picker for the user's files,
 * has the server copy them into Besidka's storage, and hands each copy to
 * `attach` (the composer's own rule for what the chosen model can read), so
 * a copy becomes a chip like an uploaded file. `driveImports` is the
 * progress and the per-file errors shown beside the chips. The Google
 * script is loaded only inside `attachFromDrive()`.
 */
export function useChatDriveFiles(
  attachedFiles: ModelRef<FileMetadata[]>,
  attach: (files: AttachedFile[]) => void,
) {
  const nuxtApp = useNuxtApp()
  const { ensureSendConsent } = useLegalConsent()
  const { pick } = useGooglePicker()
  const { routeSlug } = useChatRoute()
  const { rememberChatGoogleData } = useChatGoogleData()
  const driveImports = ref<DriveImportProgress[]>([])
  const isPicking = shallowRef<boolean>(false)

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
    } catch (exception) {
      void exception

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

  async function importPicked(items: PickedDriveItem[]) {
    setProgress(items)

    let response: Awaited<ReturnType<typeof requestImport>>

    try {
      response = await requestImport(items)
    } catch (exception) {
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

    attach(copies.filter((copy) => {
      return !existingKeys.has(copy.storageKey)
    }))

    if (routeSlug.value) {
      rememberChatGoogleData(routeSlug.value, true)
    }

    nuxtApp.callHook('files:uploaded')
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

  async function attachFromDrive() {
    if (isDriveBusy.value) {
      return
    }

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

    isPicking.value = true

    let result: Awaited<ReturnType<typeof pick>>

    try {
      result = await pick({
        maxItems: Math.min(remainingSlots, GOOGLE_DRIVE_PICK_MAX),
      })
    } finally {
      isPicking.value = false
    }

    if (result.status === 'cancelled') {
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

    await importPicked(result.items)
  }

  function dismissDriveImport(id: string) {
    removeProgress(id)
  }

  function dismissAllDriveImports() {
    driveImports.value = []
  }

  nuxtApp.hook('chat:submit', () => {
    dismissAllDriveImports()
  })

  return {
    driveImports,
    importingCount,
    isDriveBusy,
    attachFromDrive,
    dismissDriveImport,
    dismissAllDriveImports,
  }
}
