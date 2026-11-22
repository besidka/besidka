import { parseError } from 'evlog'
import type { GoogleConnectionSummary } from '#shared/utils/google-connections'
import { GOOGLE_DRIVE_SAVED_FILE_ROUTE } from '#shared/utils/google-drive-tools'

export interface DriveSavedState {
  link: string
  driveFileId: string
}

/**
 * The "Save to Google Drive" action of a file card: whether it is offered
 * at all and the save itself. It is offered only while `google.drive` is
 * active and the user holds an active Drive connection. The connection is
 * read once per session into shared state, only once the flag is active
 * (also when the flag turns active after the card mounted), never once per
 * card. A saved file is remembered by its storage key for the session;
 * after a reload the first click on a file that was saved before answers
 * with its existing Drive link and creates nothing.
 */
export function useGoogleDriveSave() {
  const googleDriveFeature = useFeature('google.drive')
  const connection = useState<GoogleConnectionSummary | null>(
    'google-drive-save-connection',
    () => null,
  )
  const hasRequestedConnection = useState<boolean>(
    'google-drive-save-connection-requested',
    () => false,
  )
  const savedByStorageKey = useState<Record<string, DriveSavedState>>(
    'google-drive-saved-files',
    () => ({}),
  )
  const { ensureSendConsent } = useLegalConsent()

  async function loadConnection() {
    if (hasRequestedConnection.value) {
      return
    }

    hasRequestedConnection.value = true

    try {
      const response = await $fetch('/api/v1/google/connections')

      connection.value = response.connection
    } catch {
      hasRequestedConnection.value = false
    }
  }

  watch(
    () => googleDriveFeature.value.active,
    async (isActive) => {
      if (isActive) {
        await loadConnection()
      }
    },
    { immediate: true },
  )

  const isAvailable = computed<boolean>(() => {
    return googleDriveFeature.value.active
      && connection.value?.status === 'active'
      && connection.value.capabilities.includes('drive-picked')
  })

  function getSaved(storageKey: string): DriveSavedState | null {
    return savedByStorageKey.value[storageKey] ?? null
  }

  async function save(storageKey: string): Promise<DriveSavedState | null> {
    if (!await ensureSendConsent(null)) {
      return null
    }

    try {
      const response = await $fetch(GOOGLE_DRIVE_SAVED_FILE_ROUTE, {
        method: 'POST',
        body: { storageKey },
      })
      const saved = {
        link: response.link,
        driveFileId: response.driveFileId,
      }

      savedByStorageKey.value = {
        ...savedByStorageKey.value,
        [storageKey]: saved,
      }

      return saved
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Could not save to Google Drive',
        parsedException.why,
      )

      return null
    }
  }

  return { isAvailable, getSaved, save }
}
