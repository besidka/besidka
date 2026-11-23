import {
  GOOGLE_KEYS_TAB_PATH,
  buildGoogleEntryPath,
} from '#shared/utils/google-connectors'
import { GOOGLE_DRIVE_BRAND_NAME } from '#shared/utils/google-drive'

export const GOOGLE_DRIVE_TAB_ID = 'google-drive'
export const GOOGLE_DRIVE_TAB_LABEL = GOOGLE_DRIVE_BRAND_NAME
export const GOOGLE_DRIVE_TAB_TEST_ID = 'files-source-google-drive'

export interface GoogleDriveConnectTarget {
  path: string
  pageName: string
  openLabel: string
}

/**
 * Where a user connects Google Drive: the Google Drive panel on the
 * Connectors page, or the Google tab of API Keys for an account without the
 * `connectors` flag.
 */
export function getGoogleDriveConnectTarget(
  isConnectorsActive: boolean,
): GoogleDriveConnectTarget {
  return isConnectorsActive
    ? {
      path: buildGoogleEntryPath('google-drive'),
      pageName: 'Connectors page',
      openLabel: 'Open Connectors',
    }
    : {
      path: GOOGLE_KEYS_TAB_PATH,
      pageName: 'API Keys page',
      openLabel: 'Open API Keys',
    }
}

export function getGoogleDriveTabNotConnected(
  target: GoogleDriveConnectTarget,
): string {
  return `Connect Google Drive on the ${target.pageName} to pick files from it.`
}

export function getGoogleDriveTabReauthorize(
  target: GoogleDriveConnectTarget,
): string {
  return 'Google no longer accepts the connection. Reconnect Google Drive on '
    + `the ${target.pageName}.`
}

export const GOOGLE_DRIVE_TAB_STATUS_FAILED
  = 'The Google Drive connection could not be checked.'
export const GOOGLE_DRIVE_TAB_EMPTY_TITLE = 'No Google Drive files yet'
export const GOOGLE_DRIVE_TAB_EMPTY_DESCRIPTION
  = 'Pick files in Google Drive and Besidka saves a copy here, ready to '
    + 'attach to a message.'
export const GOOGLE_DRIVE_TAB_PICK_LABEL = 'Pick from Google Drive'
export const GOOGLE_DRIVE_TAB_RECONNECT_LABEL = 'Reconnect'
export const GOOGLE_DRIVE_TAB_ORIGINAL_KEPT
  = 'The original in Google Drive is not deleted.'
export const GOOGLE_DRIVE_TAB_REFRESH_SWAPPED
  = 'It replaced the copy attached to your message. The earlier copy stays '
    + 'in your files for the messages that used it.'
export const GOOGLE_DRIVE_TAB_REFRESH_KEPT_EARLIER
  = 'The earlier copy stays in your files for the messages that used it.'
