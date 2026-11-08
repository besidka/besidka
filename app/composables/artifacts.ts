import { parseError } from 'evlog'
import { LazyChatArtifactDetail } from '#components'
import type {
  ArtifactDetail,
  ArtifactKind,
  ArtifactVersionContent,
} from '#shared/utils/artifacts'

export type ArtifactPanelSource = 'owner' | 'shared'

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
}

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
export const ARTIFACT_AUTO_OPEN_MEDIA_QUERY = '(min-width: 64rem)'

const ARTIFACT_AUTO_OPEN_MARKER = '1'
const UNAVAILABLE_STATUSES = new Set<number>([403, 404, 410])
const ARTIFACT_PUBLIC_ID_PATTERN = /^[A-Za-z0-9]{16,32}$/
const UNAVAILABLE_STATUS = 404
const UNAVAILABLE_MESSAGE = 'Artifact unavailable'

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

  if (request.source === 'shared') {
    const shareSlug = encodeURIComponent(request.shareSlug ?? '')

    return `/api/v1/shared/${shareSlug}/artifacts/${artifactId}`
      + `/versions/${version}`
  }

  return `/api/v1/artifacts/${artifactId}/versions/${version}`
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

    state.value = { ...target, viewKey }

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

    state.value = { ...current, ...changes }

    const currentView = sidePanel.currentView.value

    if (
      changes.title
      && currentView?.viewKey === viewKey
      && currentView.title !== changes.title
    ) {
      sidePanel.push({ ...currentView, title: changes.title })
    }
  }

  function selectVersion(version: number): void {
    if (!state.value) {
      return
    }

    state.value = { ...state.value, version }
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

async function loadArtifactResource<Value>(
  url: string,
  options: { notify?: boolean } = {},
): Promise<ArtifactLoadResult<Value>> {
  try {
    const value = await $fetch<Value>(url)

    return { ok: true, value }
  } catch (exception) {
    const parsedException = parseError(exception)
    const status = parsedException.status || 500

    if (options.notify !== false && !isArtifactUnavailableStatus(status)) {
      useErrorMessage(
        parsedException.message || 'Could not load the artifact',
        parsedException.why,
      )
    }

    return {
      ok: false,
      status,
      message: parsedException.message || 'Could not load the artifact',
    }
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
