import { parseError } from 'evlog'
import {
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  GOOGLE_DRIVE_PICK_MAX,
} from '#shared/utils/google-drive'

export const GOOGLE_API_SCRIPT_URL = 'https://apis.google.com/js/api.js'
export const GOOGLE_PICKER_SCRIPT_TIMEOUT_MS = 15_000
export const GOOGLE_PICKER_LOAD_TIMEOUT_MS = 20_000
export const GOOGLE_PICKER_IDLE_TIMEOUT_MS = 15 * 60 * 1000

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
  = | { status: 'picked', items: PickedDriveItem[], rejected: RejectedDriveItem[] }
    | { status: 'cancelled' }
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

interface DocsViewLike {
  setIncludeFolders: (include: boolean) => DocsViewLike
  setSelectFolderEnabled: (enabled: boolean) => DocsViewLike
  setEnableDrives: (enabled: boolean) => DocsViewLike
}

interface PickerBuilderLike {
  addView: (view: DocsViewLike) => PickerBuilderLike
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
    return { status: 'cancelled' }
  }

  return { status: 'picked', items, rejected }
}

function showPicker(
  token: PickerToken,
  maxItems: number,
): Promise<GooglePickerResult> {
  const picker = readGlobals().google?.picker

  if (!picker) {
    return Promise.resolve(toFailure(
      'script-blocked',
      'Google\'s file picker did not load',
    ))
  }

  return new Promise<GooglePickerResult>((resolve) => {
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

      resolve(result)
    }

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

    const docsView = new picker.DocsView(picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setEnableDrives(true)

    instance = new picker.PickerBuilder()
      .addView(docsView)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setMaxItems(maxItems)
      .setOAuthToken(token.accessToken)
      .setDeveloperKey(token.apiKey)
      .setAppId(token.appId)
      .setOrigin(`${window.location.protocol}//${window.location.host}`)
      .setCallback((response) => {
        if (response.action === picker.Action.LOADED) {
          startTimer(
            GOOGLE_PICKER_IDLE_TIMEOUT_MS,
            toFailure(
              'timeout',
              'The Google Drive picker was left open too long',
            ),
          )

          return
        }

        if (response.action === picker.Action.CANCEL) {
          finish({ status: 'cancelled' })

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
 * Google loads until `pick()` is called, so a user who never asks for Google
 * Drive never loads Google's script. The access token comes from
 * `POST /api/v1/google/drive/picker-token`, lives only inside this call and
 * is never stored; no Google Identity Services is used. Every failure path
 * returns a value (script blocked or timed out, not connected, needs
 * reauthorization, Picker not configured, the Picker never opening, which
 * is how a missing Google sign-in in this browser shows, a Drive refusal,
 * an idle timeout) so the caller decides what to tell the user.
 */
export function useGooglePicker() {
  const isPicking = shallowRef<boolean>(false)

  async function pick(
    options: { maxItems?: number } = {},
  ): Promise<GooglePickerResult> {
    if (isPicking.value) {
      return { status: 'cancelled' }
    }

    isPicking.value = true

    try {
      const token = await fetchPickerToken()

      if (!isPickerToken(token)) {
        return token
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

      const maxItems = Math.min(
        options.maxItems ?? GOOGLE_DRIVE_PICK_MAX,
        GOOGLE_DRIVE_PICK_MAX,
      )

      return await showPicker(token, maxItems)
    } finally {
      isPicking.value = false
    }
  }

  return { isPicking, pick }
}
