import { parseError } from 'evlog'
import { LazyChatArtifactDetail } from '#components'
import type { DiagramLimitCode } from '@besidka/artifacts-protocol'
import type {
  ArtifactDetail,
  ArtifactKind,
  ArtifactVersionContent,
} from '#shared/utils/artifacts'

export type ArtifactPanelSource = 'owner' | 'shared' | 'public-share'

export type ArtifactStreamStatus = 'streaming' | 'done' | 'failed'

export interface ArtifactPanelTarget {
  artifactId: string | null
  version: number | null
  kind: ArtifactKind | null
  title: string
  source: ArtifactPanelSource
  shareSlug?: string
  toolCallId?: string
}

export interface ArtifactPanelState extends ArtifactPanelTarget {
  viewKey: string
  isVersionPinned: boolean
}

export type ArtifactVersionRefresh = 'switch' | 'offer' | 'none'

export interface ArtifactStreamState {
  toolCallId: string
  kind: ArtifactKind | null
  title: string
  content: string
  status: ArtifactStreamStatus
  errorText?: string
}

export interface ArtifactRuntimeMessage {
  level: 'error' | 'warning'
  message: string
  stack?: string
  code?: DiagramLimitCode
  limit?: number
  found?: number
}

export interface ArtifactVersionRequest {
  artifactId: string
  version: number
  source: ArtifactPanelSource
  shareSlug?: string
}

export type ArtifactLoadResult<Value>
  = | { ok: true, value: Value }
    | { ok: false, status: number, message: string }

export const ARTIFACT_VIEW_KEY_PREFIX = 'artifact:'
export const ARTIFACT_AUTO_OPEN_STORAGE_PREFIX = 'artifacts:auto-opened:'
export const ARTIFACT_AUTO_OPEN_MEDIA_QUERY
  = `(min-width: ${SIDE_PANEL_DOCK_MIN_VIEWPORT}px)`
export const ARTIFACT_LOAD_TIMEOUT_MS = 10_000

const ARTIFACT_AUTO_OPEN_MARKER = '1'
const UNAVAILABLE_STATUSES = new Set<number>([403, 404, 410])
const ARTIFACT_PUBLIC_ID_PATTERN = /^[A-Za-z0-9]{16,32}$/
const UNAVAILABLE_STATUS = 404
const UNAVAILABLE_MESSAGE = 'Artifact unavailable'
const TIMEOUT_STATUS = 408
const TIMEOUT_MESSAGE = 'The artifact took too long to load'
const TIMEOUT_ERROR_NAME = 'TimeoutError'

export function getArtifactViewKey(
  target: Pick<ArtifactPanelTarget, 'artifactId' | 'toolCallId'>,
): string {
  if (target.toolCallId) {
    return `${ARTIFACT_VIEW_KEY_PREFIX}call:${target.toolCallId}`
  }

  return `${ARTIFACT_VIEW_KEY_PREFIX}${target.artifactId ?? 'pending'}`
}

export function isArtifactViewKey(viewKey: string | null): boolean {
  return !!viewKey?.startsWith(ARTIFACT_VIEW_KEY_PREFIX)
}

export function getArtifactAutoOpenKey(chatId: string): string {
  return `${ARTIFACT_AUTO_OPEN_STORAGE_PREFIX}${chatId}`
}

export function hasArtifactAutoOpened(chatId: string): boolean {
  try {
    return window.sessionStorage.getItem(getArtifactAutoOpenKey(chatId))
      !== null
  } catch {
    return true
  }
}

export function markArtifactAutoOpened(chatId: string): boolean {
  try {
    window.sessionStorage.setItem(
      getArtifactAutoOpenKey(chatId),
      ARTIFACT_AUTO_OPEN_MARKER,
    )

    return true
  } catch {
    return false
  }
}

export function isArtifactUnavailableStatus(status: number): boolean {
  return UNAVAILABLE_STATUSES.has(status)
}

export function isArtifactPublicId(value: unknown): value is string {
  return typeof value === 'string' && ARTIFACT_PUBLIC_ID_PATTERN.test(value)
}

export function isArtifactVersionNumber(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
}

export function getArtifactVersionUrl(
  request: ArtifactVersionRequest,
): string | null {
  if (
    !isArtifactPublicId(request.artifactId)
    || !isArtifactVersionNumber(request.version)
  ) {
    return null
  }

  const { artifactId, version } = request

  if (request.source === 'public-share') {
    return null
  }

  if (request.source === 'shared') {
    const shareSlug = encodeURIComponent(request.shareSlug ?? '')

    return `/api/v1/shared/${shareSlug}/artifacts/${artifactId}`
      + `/versions/${version}`
  }

  return `/api/v1/artifacts/${artifactId}/versions/${version}`
}

export function resolveArtifactVersionRefresh(input: {
  selectedVersion: number | null
  latestVersion: number | null
  isVersionPinned: boolean
}): ArtifactVersionRefresh {
  const { selectedVersion, latestVersion } = input

  if (
    latestVersion === null
    || (selectedVersion !== null && latestVersion <= selectedVersion)
  ) {
    return 'none'
  }

  return input.isVersionPinned ? 'offer' : 'switch'
}

function getUnavailableResult<Value>(): ArtifactLoadResult<Value> {
  return {
    ok: false,
    status: UNAVAILABLE_STATUS,
    message: UNAVAILABLE_MESSAGE,
  }
}

/**
 * State of the artifact detail view in the shared side panel. The view reads
 * its target from `useState`, not from panel props, so a streaming artifact
 * that becomes a stored version keeps the same view (and the same iframe).
 */
export function useArtifactPanel() {
  const sidePanel = useSidePanel()
  const state = useState<ArtifactPanelState | null>(
    'artifact-panel',
    () => null,
  )
  const stream = useState<ArtifactStreamState | null>(
    'artifact-panel:stream',
    () => null,
  )
  const unavailableIds = useState<Record<string, true>>(
    'artifact-panel:unavailable',
    () => ({}),
  )
  const latestVersions = useState<Record<string, number>>(
    'artifact-panel:latest-versions',
    () => ({}),
  )

  const isOpen = computed<boolean>(() => {
    return sidePanel.isOpen.value && isArtifactViewKey(sidePanel.viewKey.value)
  })

  function isOpenOn(viewKey: string): boolean {
    return sidePanel.isOpen.value && sidePanel.viewKey.value === viewKey
  }

  function open(
    target: ArtifactPanelTarget,
    options: { push?: boolean } = {},
  ): void {
    const viewKey = getArtifactViewKey(target)

    const latestVersion = target.artifactId
      ? latestVersions.value[target.artifactId] ?? null
      : null

    state.value = {
      ...target,
      viewKey,
      isVersionPinned: target.version !== null
        && latestVersion !== null
        && target.version < latestVersion,
    }

    const view = {
      viewKey,
      title: target.title || 'Artifact',
      mode: 'detail' as const,
      component: LazyChatArtifactDetail,
    }

    if (options.push) {
      sidePanel.push(view)

      return
    }

    sidePanel.open(view)
  }

  function updateTarget(
    viewKey: string,
    changes: Partial<ArtifactPanelTarget>,
  ): void {
    const current = state.value

    if (current?.viewKey !== viewKey) {
      return
    }

    const changedKeys = (
      Object.keys(changes) as Array<keyof ArtifactPanelTarget>
    ).filter((key) => {
      return changes[key] !== current[key]
    })

    if (!changedKeys.length) {
      return
    }

    const version = changes.version ?? current.version
    const latestVersion = current.artifactId
      ? latestVersions.value[current.artifactId] ?? 0
      : 0

    state.value = {
      ...current,
      ...changes,
      isVersionPinned: 'version' in changes
        ? version !== null && version < latestVersion
        : current.isVersionPinned,
    }

    const currentView = sidePanel.currentView.value

    if (
      changes.title
      && currentView?.viewKey === viewKey
      && currentView.title !== changes.title
    ) {
      sidePanel.push({ ...currentView, title: changes.title })
    }
  }

  function selectVersion(
    version: number,
    knownLatestVersion: number | null = null,
  ): void {
    const current = state.value

    if (!current) {
      return
    }

    const latestVersion = Math.max(
      current.artifactId ? latestVersions.value[current.artifactId] ?? 0 : 0,
      knownLatestVersion ?? 0,
    )

    state.value = {
      ...current,
      version,
      isVersionPinned: version < latestVersion,
    }
  }

  function noteVersion(artifactId: string, version: number): void {
    const known = latestVersions.value[artifactId] ?? 0

    if (version <= known) {
      return
    }

    latestVersions.value = { ...latestVersions.value, [artifactId]: version }
  }

  function getLatestVersion(artifactId: string | null): number | null {
    return artifactId ? latestVersions.value[artifactId] ?? null : null
  }

  function setStream(value: ArtifactStreamState | null): void {
    stream.value = value
  }

  function close(): void {
    if (!isOpen.value) {
      return
    }

    sidePanel.close()
  }

  function markUnavailable(artifactId: string): void {
    unavailableIds.value = { ...unavailableIds.value, [artifactId]: true }
  }

  function isUnavailable(artifactId: string): boolean {
    return unavailableIds.value[artifactId] === true
  }

  return {
    state,
    stream,
    isOpen,
    isOpenOn,
    open,
    updateTarget,
    selectVersion,
    noteVersion,
    getLatestVersion,
    latestVersions,
    setStream,
    close,
    markUnavailable,
    isUnavailable,
  }
}

/**
 * Versions of each artifact that the shared chat on the current page
 * references, filled by the shared chat page. A shared-chat viewer can only
 * load these.
 */
export function useSharedArtifactVersions() {
  return useState<Record<string, number[]>>(
    'artifact-panel:shared-versions',
    () => ({}),
  )
}

/**
 * Opens the first artifact of a streaming generation next to the chat once
 * per chat and tab. Only at the docked layout (never a full-screen sheet
 * unasked), only on the owner's chat page with artifacts available, and only
 * while nothing else is open in the side panel. The sessionStorage marker is
 * the `artifacts:auto-opened:<chat id>` row of the Cookie Policy.
 */
export function useArtifactAutoOpen() {
  const artifacts = useFeature('artifacts')
  const sidePanel = useSidePanel()
  const isLarge = useMediaQuery(ARTIFACT_AUTO_OPEN_MEDIA_QUERY)
  const { open } = useArtifactPanel()

  function tryAutoOpen(chatId: string, target: ArtifactPanelTarget): boolean {
    if (
      !chatId
      || target.source !== 'owner'
      || !artifacts.value.active
      || !isLarge.value
      || sidePanel.isOpen.value
      || hasArtifactAutoOpened(chatId)
    ) {
      return false
    }

    if (!markArtifactAutoOpened(chatId)) {
      return false
    }

    open(target)

    return true
  }

  return { tryAutoOpen }
}

function isTimeoutError(exception: unknown): boolean {
  if (!(exception instanceof Error)) {
    return false
  }

  const cause = exception.cause

  return exception.name === TIMEOUT_ERROR_NAME
    || (cause instanceof Error && cause.name === TIMEOUT_ERROR_NAME)
}

function toFailure(exception: unknown): { status: number, message: string } {
  if (isTimeoutError(exception)) {
    return { status: TIMEOUT_STATUS, message: TIMEOUT_MESSAGE }
  }

  const parsedException = parseError(exception)

  return {
    status: parsedException.status || 500,
    message: parsedException.message || 'Could not load the artifact',
  }
}

async function loadArtifactResource<Value>(
  url: string,
  options: { notify?: boolean } = {},
): Promise<ArtifactLoadResult<Value>> {
  try {
    const value = await $fetch<Value>(url, {
      timeout: ARTIFACT_LOAD_TIMEOUT_MS,
    })

    return { ok: true, value }
  } catch (exception) {
    const failure = toFailure(exception)
    const shouldNotify = options.notify !== false
      && !isArtifactUnavailableStatus(failure.status)

    if (shouldNotify) {
      useErrorMessage(failure.message, parseError(exception).why)
    }

    return { ok: false, ...failure }
  }
}

export async function loadArtifactVersion(
  request: ArtifactVersionRequest,
  options: { notify?: boolean } = {},
): Promise<ArtifactLoadResult<ArtifactVersionContent>> {
  const url = getArtifactVersionUrl(request)

  if (!url) {
    return getUnavailableResult()
  }

  return loadArtifactResource<ArtifactVersionContent>(url, options)
}

export async function loadArtifactDetail(
  artifactId: string,
  options: { notify?: boolean } = {},
): Promise<ArtifactLoadResult<ArtifactDetail>> {
  if (!isArtifactPublicId(artifactId)) {
    return getUnavailableResult()
  }

  return loadArtifactResource<ArtifactDetail>(
    `/api/v1/artifacts/${artifactId}`,
    options,
  )
}
