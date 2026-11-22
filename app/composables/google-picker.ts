import { parseError } from 'evlog'
import {
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  GOOGLE_DRIVE_PICK_MAX,
  isDriveFileId,
} from '#shared/utils/google-drive'

export const GOOGLE_API_SCRIPT_URL = 'https://apis.google.com/js/api.js'
export const GOOGLE_PICKER_SCRIPT_TIMEOUT_MS = 15_000
export const GOOGLE_PICKER_LOAD_TIMEOUT_MS = 20_000
export const GOOGLE_PICKER_IDLE_TIMEOUT_MS = 15 * 60 * 1000
export const GOOGLE_PICKER_STATUS_INDICATOR_DELAY_MS = 300

const GOOGLE_API_SCRIPT_SELECTOR = 'script[data-google-api-script]'

export type GooglePickerFailure
  = | 'not-connected'
    | 'reauthorize'
    | 'not-configured'
    | 'script-blocked'
    | 'blocked'
    | 'not-signed-in'
    | 'timeout'
    | 'drive-error'
    | 'failed'

export interface PickedDriveItem {
  id: string
  name: string
  mimeType: string
  resourceKey?: string
  url?: string
}

export interface RejectedDriveItem {
  name: string
  error: string
}

export type GooglePickerResult
  = | {
    status: 'picked'
    items: PickedDriveItem[]
    rejected: RejectedDriveItem[]
  }
  | { status: 'canceled' }
  | {
    status: 'error'
    code: GooglePickerFailure
    message: string
    why?: string
  }

interface PickerDocumentLike {
  id?: string
  name?: string
  mimeType?: string
  url?: string
  resourceKey?: string
  driveSuccess?: boolean
  driveError?: string
}

interface PickerResponseLike {
  action?: string
  docs?: PickerDocumentLike[]
}

interface PickerLike {
  setVisible: (visible: boolean) => PickerLike
  dispose: () => void
}

interface PickerViewLike {
  setLabel?: (label: string) => unknown
}

interface DocsViewLike extends PickerViewLike {
  setIncludeFolders: (include: boolean) => DocsViewLike
  setSelectFolderEnabled: (enabled: boolean) => DocsViewLike
  setEnableDrives: (enabled: boolean) => DocsViewLike
  setOwnedByMe: (isOwnedByMe: boolean) => DocsViewLike
  setMode: (mode: string) => DocsViewLike
  setFileIds: (fileIds: string) => DocsViewLike
}

interface PickerBuilderLike {
  addView: (view: PickerViewLike) => PickerBuilderLike
  enableFeature: (feature: string) => PickerBuilderLike
  setMaxItems: (maximum: number) => PickerBuilderLike
  setOAuthToken: (token: string) => PickerBuilderLike
  setDeveloperKey: (key: string) => PickerBuilderLike
  setAppId: (appId: string) => PickerBuilderLike
  setOrigin: (origin: string) => PickerBuilderLike
  setCallback: (
    callback: (response: PickerResponseLike) => void,
  ) => PickerBuilderLike
  build: () => PickerLike
}

interface GooglePickerNamespace {
  PickerBuilder: new () => PickerBuilderLike
  DocsView: new (viewId?: string) => DocsViewLike
  DocsUploadView?: new () => PickerViewLike
  DocsViewMode?: { LIST: string }
  ViewId: { DOCS: string }
  Feature: { MULTISELECT_ENABLED: string, SUPPORT_DRIVES: string }
  Action: { PICKED: string, CANCEL: string, LOADED?: string }
}

interface GoogleGlobals {
  gapi?: {
    load: (
      library: string,
      options: {
        callback: () => void
        onerror: () => void
        timeout: number
        ontimeout: () => void
      },
    ) => void
  }
  google?: { picker?: GooglePickerNamespace }
}

interface PickerToken {
  accessToken: string
  apiKey: string
  appId: string
  expiresInSeconds: number
}

const TOOLS_TRIGGER_SELECTOR = '.js-chat-input-tools-trigger'

function returnFocusToToolsButton() {
  document.querySelector<HTMLElement>(TOOLS_TRIGGER_SELECTOR)?.focus()
}

let pickerLibraryLoad: Promise<void> | null = null

function readGlobals(): GoogleGlobals {
  return window as unknown as GoogleGlobals
}

function loadGoogleApiScript(): Promise<void> {
  if (readGlobals().gapi) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    const timer = setTimeout(() => {
      script.remove()
      reject(new Error('script-timeout'))
    }, GOOGLE_PICKER_SCRIPT_TIMEOUT_MS)

    script.src = GOOGLE_API_SCRIPT_URL
    script.async = true
    script.referrerPolicy = 'no-referrer'
    script.dataset.googleApiScript = 'true'
    script.onload = () => {
      clearTimeout(timer)
      resolve()
    }
    script.onerror = () => {
      clearTimeout(timer)
      script.remove()
      reject(new Error('script-blocked'))
    }
    document.head
      .querySelectorAll(GOOGLE_API_SCRIPT_SELECTOR)
      .forEach(stale => stale.remove())
    document.head.appendChild(script)
  })
}

function loadPickerLibrary(): Promise<void> {
  if (readGlobals().google?.picker) {
    return Promise.resolve()
  }

  if (pickerLibraryLoad) {
    return pickerLibraryLoad
  }

  async function load(): Promise<void> {
    try {
      await loadGoogleApiScript()
      await loadPickerFromGapi()
    } catch (exception) {
      pickerLibraryLoad = null

      throw exception
    }
  }

  pickerLibraryLoad = load()

  return pickerLibraryLoad
}

function loadPickerFromGapi(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const gapi = readGlobals().gapi

    if (!gapi) {
      reject(new Error('script-blocked'))

      return
    }

    gapi.load('picker', {
      callback: resolve,
      onerror: () => reject(new Error('script-blocked')),
      timeout: GOOGLE_PICKER_SCRIPT_TIMEOUT_MS,
      ontimeout: () => reject(new Error('script-timeout')),
    })
  })
}

function toFailure(
  code: GooglePickerFailure,
  message: string,
  why?: string,
): GooglePickerResult {
  return { status: 'error', code, message, why }
}

function readHttpStatus(exception: unknown): number | null {
  const record = exception as { status?: unknown, statusCode?: unknown }
  const status = record.status ?? record.statusCode

  return typeof status === 'number' ? status : null
}

async function fetchPickerToken(): Promise<PickerToken | GooglePickerResult> {
  try {
    const response = await $fetch('/api/v1/google/drive/picker-token', {
      method: 'POST',
    })

    return {
      accessToken: response.accessToken,
      apiKey: response.apiKey,
      appId: response.appId,
      expiresInSeconds: response.expiresInSeconds,
    }
  } catch (exception) {
    const parsed = parseError(exception)
    const status = readHttpStatus(exception)

    if (status === 404) {
      return toFailure('not-connected', parsed.message, parsed.why)
    }

    if (status === 409) {
      return toFailure('reauthorize', parsed.message, parsed.why)
    }

    if (status === 503) {
      return toFailure('not-configured', parsed.message, parsed.why)
    }

    return toFailure(
      'failed',
      parsed.message || 'Google Drive could not be opened',
      parsed.why,
    )
  }
}

async function checkDriveConnection(): Promise<GooglePickerResult | null> {
  try {
    const response = await $fetch('/api/v1/google/connections')
    const connection = response.connection

    if (!connection) {
      return toFailure('not-connected', 'Google Drive is not connected')
    }

    if (
      connection.status !== 'active'
      || !connection.capabilities.includes('drive-picked')
    ) {
      return toFailure(
        'reauthorize',
        'Google Drive needs to be connected again',
      )
    }

    return null
  } catch (exception) {
    const parsed = parseError(exception)

    return toFailure(
      'failed',
      parsed.message || 'Google Drive could not be opened',
      parsed.why,
    )
  }
}

function isPickerToken(
  value: PickerToken | GooglePickerResult,
): value is PickerToken {
  return 'accessToken' in value
}

function collectPickedItems(response: PickerResponseLike): GooglePickerResult {
  const items: PickedDriveItem[] = []
  const rejected: RejectedDriveItem[] = []

  for (const doc of response.docs ?? []) {
    const name = doc.name || 'Google Drive file'

    if (doc.driveSuccess === false) {
      rejected.push({
        name,
        error: doc.driveError || 'Google Drive did not share this file',
      })

      continue
    }

    if (
      !doc.id
      || !doc.mimeType
      || doc.mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE
    ) {
      continue
    }

    items.push({
      id: doc.id,
      name,
      mimeType: doc.mimeType,
      ...(doc.resourceKey ? { resourceKey: doc.resourceKey } : {}),
      ...(doc.url ? { url: doc.url } : {}),
    })
  }

  if (items.length === 0 && rejected.length > 0) {
    return toFailure(
      'drive-error',
      'Google Drive did not share the file you picked',
      rejected[0]?.error,
    )
  }

  if (items.length === 0) {
    return { status: 'canceled' }
  }

  return { status: 'picked', items, rejected }
}

export const GOOGLE_PICKER_VIEW_LABELS = {
  recent: 'Recent',
  sharedWithMe: 'Shared with me',
  sharedDrives: 'Shared drives',
  upload: 'Upload',
} as const

function labelView<View extends PickerViewLike>(
  view: View,
  label: string,
): View {
  view.setLabel?.(label)

  return view
}

function listMode(
  picker: GooglePickerNamespace,
  view: DocsViewLike,
): DocsViewLike {
  const mode = picker.DocsViewMode?.LIST

  return mode ? view.setMode(mode) : view
}

type PickerViewFactory = (picker: GooglePickerNamespace) => PickerViewLike

const PICKER_TAB_FACTORIES: readonly PickerViewFactory[] = [
  (picker) => {
    return labelView(
      listMode(
        picker,
        new picker.DocsView(picker.ViewId.DOCS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(false),
      ),
      GOOGLE_PICKER_VIEW_LABELS.recent,
    )
  },
  (picker) => {
    return labelView(
      listMode(
        picker,
        new picker.DocsView(picker.ViewId.DOCS)
          .setIncludeFolders(false)
          .setOwnedByMe(false),
      ),
      GOOGLE_PICKER_VIEW_LABELS.sharedWithMe,
    )
  },
  (picker) => {
    return labelView(
      listMode(
        picker,
        new picker.DocsView(picker.ViewId.DOCS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(false)
          .setEnableDrives(true),
      ),
      GOOGLE_PICKER_VIEW_LABELS.sharedDrives,
    )
  },
  (picker) => {
    if (!picker.DocsUploadView) {
      throw new Error('upload-view-missing')
    }

    return labelView(
      new picker.DocsUploadView(),
      GOOGLE_PICKER_VIEW_LABELS.upload,
    )
  },
]

function buildSingleFileView(
  picker: GooglePickerNamespace,
  fileIds: readonly string[],
): PickerViewLike {
  return listMode(
    picker,
    new picker.DocsView(picker.ViewId.DOCS).setFileIds(fileIds.join(',')),
  )
}

/**
 * The tabs of the Picker, each built on its own so that a method Google
 * changed or removed drops one tab and never the Picker. Without file ids:
 * Recent (My Drive with folders, list mode), Shared with me
 * (`setOwnedByMe(false)`, no folders: Google ignores the owner filter when
 * folders are included), Shared drives (`setEnableDrives(true)`, which must
 * not be combined with the owner filter) and Upload (`DocsUploadView`).
 * With file ids, one view that holds only those files (`setFileIds`, which
 * Google says is overridden by `setEnableDrives` and `setParent`, so neither
 * is set): the user confirms the file once and the Picker grants Besidka
 * access to it. An empty result falls back to the plain Drive view.
 */
export function buildPickerViews(
  picker: GooglePickerNamespace,
  fileIds: readonly string[] = [],
): PickerViewLike[] {
  const factories: readonly PickerViewFactory[] = fileIds.length > 0
    ? [pickerNamespace => buildSingleFileView(pickerNamespace, fileIds)]
    : PICKER_TAB_FACTORIES
  const views: PickerViewLike[] = []

  for (const factory of factories) {
    try {
      views.push(factory(picker))
    } catch {
      continue
    }
  }

  if (views.length > 0) {
    return views
  }

  return [new picker.DocsView(picker.ViewId.DOCS)]
}

function showPicker(
  token: PickerToken,
  maxItems: number,
  fileIds: readonly string[],
  registerCancel: (cancel: () => void) => void,
): Promise<GooglePickerResult> {
  const picker = readGlobals().google?.picker

  if (!picker) {
    return Promise.resolve(toFailure(
      'script-blocked',
      'Google\'s file picker did not load',
    ))
  }

  return new Promise<GooglePickerResult>((resolve) => {
    let isDisposed = false
    let instance: PickerLike | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let isSettled = false

    function finish(result: GooglePickerResult) {
      if (isSettled) {
        return
      }

      isSettled = true

      if (timer) {
        clearTimeout(timer)
      }

      document.removeEventListener('securitypolicyviolation', onViolation)

      try {
        instance?.setVisible(false)
        instance?.dispose()
      } catch {
        instance = null
      }

      instance = null

      if (!isDisposed) {
        returnFocusToToolsButton()
      }

      resolve(result)
    }

    registerCancel(() => {
      isDisposed = true
      finish({ status: 'canceled' })
    })

    function onViolation(event: Event) {
      const violation = event as Partial<SecurityPolicyViolationEvent>
      const isFrameBlocked = !!violation.violatedDirective?.startsWith(
        'frame-src',
      )
      const isGoogleFrame = !!violation.blockedURI?.includes('google.com')

      if (!isFrameBlocked || !isGoogleFrame) {
        return
      }

      finish(toFailure(
        'blocked',
        'This page does not allow Google\'s file picker',
        'Reload the page and try again.',
      ))
    }

    document.addEventListener('securitypolicyviolation', onViolation)

    function startTimer(milliseconds: number, result: GooglePickerResult) {
      if (timer) {
        clearTimeout(timer)
      }

      timer = setTimeout(() => {
        finish(result)
      }, milliseconds)
    }

    let builder: PickerBuilderLike

    try {
      builder = buildPickerViews(picker, fileIds).reduce(
        (current, view) => current.addView(view),
        new picker.PickerBuilder(),
      )
    } catch {
      finish(toFailure(
        'failed',
        'Google\'s file picker could not be built',
        'Reload the page and try again.',
      ))

      return
    }

    instance = builder
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setMaxItems(maxItems)
      .setOAuthToken(token.accessToken)
      .setDeveloperKey(token.apiKey)
      .setAppId(token.appId)
      .setOrigin(`${window.location.protocol}//${window.location.host}`)
      .setCallback((response) => {
        if (isSettled) {
          return
        }

        if (response.action === picker.Action.LOADED) {
          startTimer(
            Math.min(
              GOOGLE_PICKER_IDLE_TIMEOUT_MS,
              Math.max(token.expiresInSeconds, 1) * 1000,
            ),
            toFailure(
              'timeout',
              'The Google Drive picker was left open too long',
            ),
          )

          return
        }

        if (response.action === picker.Action.CANCEL) {
          finish({ status: 'canceled' })

          return
        }

        if (response.action === picker.Action.PICKED) {
          finish(collectPickedItems(response))
        }
      })
      .build()

    startTimer(
      GOOGLE_PICKER_LOAD_TIMEOUT_MS,
      toFailure(
        'not-signed-in',
        'The Google Drive picker did not open',
        'Check that you are signed in to Google in this browser and that '
        + 'it allows content embedded from Google.',
      ),
    )
    instance.setVisible(true)
  })
}

/**
 * Opens Google's Drive Picker for the connected account. Nothing from
 * Google loads until `pick()` is called, and not even then until Besidka's
 * own status route (`GET /api/v1/google/connections`, fetched on every
 * call, never cached) says the Drive connection is active with the picked
 * files capability, so a user who is not connected never sends their
 * address to Google for a script they cannot use. `isCheckingConnection`
 * turns true only when that check takes longer than 300 ms. The access
 * token comes from
 * `POST /api/v1/google/drive/picker-token`, lives only inside this call and
 * is never stored; no Google Identity Services is used. Every failure path
 * returns a value (script blocked or timed out, not connected, needs
 * reauthorization, Picker not configured, the Picker never opening, which
 * is how a missing Google sign-in in this browser shows, a Drive refusal,
 * an idle timeout) so the caller decides what to tell the user.
 */
export function useGooglePicker() {
  const isPicking = shallowRef<boolean>(false)
  const isCheckingConnection = shallowRef<boolean>(false)
  let cancelOpenPicker: (() => void) | null = null
  let isScopeDisposed = false

  async function checkConnectionWithIndicator(): Promise<
    GooglePickerResult | null
  > {
    const indicatorTimer = setTimeout(() => {
      isCheckingConnection.value = true
    }, GOOGLE_PICKER_STATUS_INDICATOR_DELAY_MS)

    try {
      return await checkDriveConnection()
    } finally {
      clearTimeout(indicatorTimer)
      isCheckingConnection.value = false
    }
  }

  async function pick(
    options: { maxItems?: number, fileIds?: readonly string[] } = {},
  ): Promise<GooglePickerResult> {
    if (isPicking.value || isScopeDisposed) {
      return { status: 'canceled' }
    }

    isPicking.value = true

    try {
      const connectionFailure = await checkConnectionWithIndicator()

      if (connectionFailure || isScopeDisposed) {
        return connectionFailure ?? { status: 'canceled' }
      }

      try {
        await loadPickerLibrary()
      } catch (exception) {
        const isTimeout = exception instanceof Error
          && exception.message === 'script-timeout'

        return toFailure(
          isTimeout ? 'timeout' : 'script-blocked',
          'Google\'s file picker could not be loaded',
          'Check your connection and that no blocker stops scripts from '
          + 'apis.google.com.',
        )
      }

      const token = await fetchPickerToken()

      if (isScopeDisposed) {
        return { status: 'canceled' }
      }

      if (!isPickerToken(token)) {
        return token
      }

      const maxItems = Math.min(
        options.maxItems ?? GOOGLE_DRIVE_PICK_MAX,
        GOOGLE_DRIVE_PICK_MAX,
      )

      const fileIds = (options.fileIds ?? []).filter(isDriveFileId)

      return await showPicker(token, maxItems, fileIds, (cancel) => {
        cancelOpenPicker = cancel
      })
    } finally {
      cancelOpenPicker = null
      isPicking.value = false
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      isScopeDisposed = true
      cancelOpenPicker?.()
      cancelOpenPicker = null
    })
  }

  return { isPicking, isCheckingConnection, pick }
}
