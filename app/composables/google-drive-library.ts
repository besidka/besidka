import { parseError } from 'evlog'
import {
  GOOGLE_DRIVE_PICK_MAX,
  GOOGLE_DRIVE_REFRESH_MAX,
} from '#shared/utils/google-drive'
import type { GooglePickerResult } from '~/composables/google-picker'

interface RefreshOutcome {
  updated: string[]
  newerCopy: string[]
  upToDate: string[]
}

function chunkIds(ids: readonly string[], size: number): string[][] {
  const chunks: string[][] = []

  for (let start = 0; start < ids.length; start += size) {
    chunks.push(ids.slice(start, start + size))
  }

  return chunks
}

function readHttpStatus(exception: unknown): number | null {
  const record = exception as { status?: unknown, statusCode?: unknown }
  const status = record.status ?? record.statusCode

  return typeof status === 'number' ? status : null
}

function describeFiles(names: readonly string[]): string {
  if (names.length === 1) {
    return names[0]!
  }

  return `${names.length} files`
}

/**
 * The actions of the Google Drive tab that talk to Google or to the Drive
 * routes: picking more files, copying them in, and refreshing copies whose
 * original changed. The Picker opens above the file manager dialog by
 * suspending it (a `showModal()` dialog covers the Picker's frame) and the
 * dialog is shown again on every outcome, before the copy request starts,
 * so progress shows in the tab. Nothing from Google loads until
 * `pickMore()` is called.
 */
export function useGoogleDriveLibrary(options: {
  getFileName: (fileId: string) => string
  onChanged: () => void | Promise<void>
  onConnectionIssue: () => void
}) {
  const { ensureSendConsent } = useLegalConsent()
  const { pick } = useGooglePicker()
  const dialog = inject(FILE_MANAGER_DIALOG_KEY, noopFileManagerDialogControls)
  const isPicking = shallowRef<boolean>(false)
  const isImporting = shallowRef<boolean>(false)
  const isRefreshing = shallowRef<boolean>(false)

  const isBusy = computed<boolean>(() => {
    return isPicking.value || isImporting.value || isRefreshing.value
  })

  async function openPicker(): Promise<GooglePickerResult | null> {
    if (!await ensureSendConsent(null)) {
      return null
    }

    dialog.suspend()

    try {
      return await pick({ maxItems: GOOGLE_DRIVE_PICK_MAX })
    } finally {
      dialog.resume()
    }
  }

  function handleConnectionFailure(exception: unknown): boolean {
    const status = readHttpStatus(exception)

    if (status !== 404 && status !== 409) {
      return false
    }

    options.onConnectionIssue()

    return true
  }

  async function importPicked(
    items: Array<{ id: string, name: string, resourceKey?: string }>,
  ) {
    isImporting.value = true

    try {
      const response = await $fetch('/api/v1/google/drive/files', {
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
      let copiedCount = 0

      for (const result of response.results) {
        if (result.status === 'failed') {
          const name = items.find(item => item.id === result.id)?.name

          useWarningMessage(
            `${name ?? 'A Google Drive file'} could not be copied`,
            result.reason,
          )

          continue
        }

        copiedCount++

        if (result.note) {
          useInfoMessage(result.note)
        }
      }

      if (copiedCount > 0) {
        useSuccessMessage(
          copiedCount === 1
            ? 'Copied 1 file from Google Drive'
            : `Copied ${copiedCount} files from Google Drive`,
        )
      }
    } catch (exception) {
      const parsedException = parseError(exception)

      if (handleConnectionFailure(exception)) {
        return
      }

      useErrorMessage(
        parsedException.message || 'Google Drive files could not be copied',
        parsedException.why,
      )
    } finally {
      isImporting.value = false
    }

    await options.onChanged()
  }

  async function pickMore() {
    if (isBusy.value) {
      return
    }

    isPicking.value = true

    let result: GooglePickerResult | null

    try {
      result = await openPicker()
    } finally {
      isPicking.value = false
    }

    if (!result || result.status === 'canceled') {
      return
    }

    if (result.status === 'error') {
      if (result.code === 'not-connected' || result.code === 'reauthorize') {
        options.onConnectionIssue()

        return
      }

      useErrorMessage(result.message, result.why)

      return
    }

    for (const rejected of result.rejected) {
      useWarningMessage(
        `${rejected.name} could not be copied`,
        rejected.error,
      )
    }

    await importPicked(result.items)
  }

  function reportRefresh(outcome: RefreshOutcome) {
    if (outcome.updated.length > 0) {
      useSuccessMessage(
        outcome.updated.length === 1
          ? `Copied the new version of ${outcome.updated[0]}`
          : `Copied new versions of ${outcome.updated.length} files`,
        GOOGLE_DRIVE_TAB_REFRESH_KEPT_EARLIER,
      )
    }

    if (outcome.newerCopy.length > 0) {
      useInfoMessage(
        `A newer copy of ${describeFiles(outcome.newerCopy)} is already `
        + 'in your files',
      )
    }

    if (outcome.upToDate.length > 0) {
      useInfoMessage(
        outcome.upToDate.length === 1
          ? `${outcome.upToDate[0]} is up to date`
          : `${outcome.upToDate.length} files are up to date`,
      )
    }
  }

  async function refreshCopies(fileIds: readonly string[]) {
    if (isBusy.value || fileIds.length === 0) {
      return
    }

    isRefreshing.value = true

    const outcome: RefreshOutcome = {
      updated: [],
      newerCopy: [],
      upToDate: [],
    }

    try {
      for (const ids of chunkIds(fileIds, GOOGLE_DRIVE_REFRESH_MAX)) {
        const response = await $fetch('/api/v1/google/drive/files/refresh', {
          method: 'POST',
          body: { ids },
        })

        for (const result of response.results) {
          const name = options.getFileName(result.id)

          if (result.status === 'failed') {
            useWarningMessage(`${name} could not be refreshed`, result.reason)
          } else if (result.status === 'updated') {
            outcome.updated.push(name)

            if (result.note) {
              useInfoMessage(result.note)
            }
          } else if (result.status === 'newer_copy') {
            outcome.newerCopy.push(name)
          } else {
            outcome.upToDate.push(name)
          }
        }
      }
    } catch (exception) {
      const parsedException = parseError(exception)

      if (!handleConnectionFailure(exception)) {
        useErrorMessage(
          parsedException.message || 'Google Drive files could not be refreshed',
          parsedException.why,
        )
      }
    } finally {
      isRefreshing.value = false
    }

    reportRefresh(outcome)

    if (outcome.updated.length > 0) {
      await options.onChanged()
    }
  }

  return {
    isPicking,
    isImporting,
    isRefreshing,
    isBusy,
    pickMore,
    refreshCopies,
  }
}
