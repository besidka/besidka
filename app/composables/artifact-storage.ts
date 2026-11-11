import { ERROR_CODES, RpcError } from '@besidka/artifacts-protocol'
import type {
  HostStorageHandlers,
  JsonValue,
  StorageMode,
} from '@besidka/artifacts-protocol'
import type {
  ArtifactStorageSnapshot,
  ArtifactStorageTotals,
} from '#shared/utils/artifacts'
import {
  ARTIFACT_SHARE_HEADER,
  ARTIFACT_STORAGE_MAX_VALUE_BYTES,
  getUtf8ByteLength,
  isArtifactStorageKey,
} from '#shared/utils/artifacts'
import type { ArtifactPanelSource } from '~/composables/artifacts'

export interface ArtifactStorageState extends ArtifactStorageTotals {
  persistent: boolean
}

export interface ArtifactStorageModeInput {
  loggedIn: boolean
  featureActive: boolean
  source: ArtifactPanelSource
  artifactId: string | null | undefined
  shareAllowed?: boolean
}

export interface ArtifactStorageSessionInput {
  artifactId: string
  shareToken?: string | null
  onChange?: (state: ArtifactStorageState) => void
}

export interface ArtifactStorageSession {
  handlers: HostStorageHandlers
  ready: () => Promise<void>
}

type StorageRequest = <Result>(
  path: string,
  options?: {
    method?: 'GET' | 'PUT' | 'DELETE'
    body?: Record<string, unknown>
  },
) => Promise<Result>

const writeChains = new Map<string, Promise<unknown>>()

/**
 * Persistent storage is offered only to a signed-in viewer with their own
 * `artifacts.storage` flag, for a saved artifact opened from their own chat
 * or through a public link whose owner allowed saving. Everyone else, shared
 * chats and anonymous link viewers included, gets `memory`, so the runtime
 * keeps values in the frame and no storage request reaches the server.
 */
export function resolveArtifactStorageMode(
  input: ArtifactStorageModeInput,
): StorageMode {
  if (!input.loggedIn || !input.featureActive || !input.artifactId) {
    return 'memory'
  }

  if (input.source === 'owner') {
    return 'persistent'
  }

  return input.source === 'public-share' && input.shareAllowed === true
    ? 'persistent'
    : 'memory'
}

function readStatus(exception: unknown): number {
  const { statusCode, status } = (exception ?? {}) as {
    statusCode?: unknown
    status?: unknown
  }
  const value = [statusCode, status].find((candidate) => {
    return typeof candidate === 'number'
  })

  return typeof value === 'number' ? value : 0
}

function readErrorReason(exception: unknown): string | null {
  const data = (exception as { data?: { data?: { reason?: unknown } } })
    ?.data?.data

  return typeof data?.reason === 'string' ? data.reason : null
}

/**
 * Maps a failed storage route to the JSON-RPC error the runtime turns into
 * a `BesidkaBridgeError`. Server details never reach artifact code: the
 * runtime shows its own text for each code.
 */
export function toStorageRpcError(exception: unknown): RpcError {
  const status = readStatus(exception)

  if (status === 400 || status === 413) {
    return new RpcError(ERROR_CODES.invalidParams, 'Value rejected')
  }

  if (status === 429) {
    return new RpcError(ERROR_CODES.rateLimited, 'Too many saves')
  }

  if (status === 403 && readErrorReason(exception) === 'legal-consent') {
    return new RpcError(ERROR_CODES.consentRequired, 'Consent required')
  }

  if (status >= 400 && status < 500) {
    return new RpcError(ERROR_CODES.notAllowed, 'Saving is not allowed')
  }

  return new RpcError(ERROR_CODES.internalError, 'Storage request failed')
}

function cloneValue(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value))
}

function assertWritableValue(value: JsonValue): void {
  const serialized = JSON.stringify(value)

  if (
    serialized === undefined
    || getUtf8ByteLength(serialized) > ARTIFACT_STORAGE_MAX_VALUE_BYTES
  ) {
    throw new RpcError(ERROR_CODES.invalidParams, 'Value rejected')
  }
}

function assertKey(key: string): void {
  if (!isArtifactStorageKey(key)) {
    throw new RpcError(ERROR_CODES.invalidParams, 'Key rejected')
  }
}

function enqueueWrite<Result>(
  artifactId: string,
  task: () => Promise<Result>,
): Promise<Result> {
  const previous = writeChains.get(artifactId) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(task)
  const settled = next.catch(() => {})

  writeChains.set(artifactId, settled)
  settled.finally(() => {
    if (writeChains.get(artifactId) === settled) {
      writeChains.delete(artifactId)
    }
  })

  return next
}

export function waitForArtifactStorageWrites(artifactId: string) {
  return writeChains.get(artifactId) ?? Promise.resolve()
}

function storagePath(artifactId: string, key?: string): string {
  const base = `/api/v1/artifacts/${encodeURIComponent(artifactId)}/storage`

  return key === undefined ? base : `${base}/${encodeURIComponent(key)}`
}

function createRequest(shareToken?: string | null): StorageRequest {
  const headers: Record<string, string> = shareToken
    ? { [ARTIFACT_SHARE_HEADER]: shareToken }
    : {}

  return (path, options = {}) => {
    return $fetch(path, { ...options, headers }) as never
  }
}

/**
 * Answers `besidka/storage/*` for one frame session of a saved artifact.
 * The first request loads the viewer's snapshot once (after any write still
 * in flight from an earlier frame of the same artifact), so `get` and
 * `list` never hit the network again. Writes go to the server one at a time
 * per artifact, so a slow response can never overwrite a newer value, and
 * update the snapshot only after the server accepted them.
 */
export function createArtifactStorageSession(
  input: ArtifactStorageSessionInput,
): ArtifactStorageSession {
  const request = createRequest(input.shareToken)
  const values = new Map<string, JsonValue>()
  const totals: ArtifactStorageTotals = { keys: 0, bytes: 0 }
  let snapshot: Promise<void> | null = null

  function emitChange() {
    input.onChange?.({ persistent: true, ...totals })
  }

  function load(): Promise<void> {
    if (snapshot) {
      return snapshot
    }

    snapshot = (async () => {
      await waitForArtifactStorageWrites(input.artifactId)

      try {
        const result = await request<ArtifactStorageSnapshot>(
          storagePath(input.artifactId),
        )

        values.clear()

        for (const item of result.items) {
          values.set(item.key, (item.value ?? null) as JsonValue)
        }

        totals.keys = result.keys
        totals.bytes = result.bytes
        emitChange()
      } catch (exception) {
        snapshot = null

        throw toStorageRpcError(exception)
      }
    })()

    return snapshot
  }

  const handlers: HostStorageHandlers = {
    async get({ key }) {
      await load()

      const value = values.get(key)

      return { value: value === undefined ? null : cloneValue(value) }
    },
    async set({ key, value }) {
      assertKey(key)
      assertWritableValue(value)
      await load()

      const sent = cloneValue(value)

      await enqueueWrite(input.artifactId, async () => {
        try {
          const result = await request<ArtifactStorageTotals>(
            storagePath(input.artifactId, key),
            { method: 'PUT', body: { value: sent } },
          )

          values.set(key, sent)
          totals.keys = result.keys
          totals.bytes = result.bytes
          emitChange()
        } catch (exception) {
          throw toStorageRpcError(exception)
        }
      })

      return {}
    },
    async delete({ key }) {
      assertKey(key)
      await load()

      await enqueueWrite(input.artifactId, async () => {
        try {
          const result = await request<ArtifactStorageTotals>(
            storagePath(input.artifactId, key),
            { method: 'DELETE' },
          )

          values.delete(key)
          totals.keys = result.keys
          totals.bytes = result.bytes
          emitChange()
        } catch (exception) {
          throw toStorageRpcError(exception)
        }
      })

      return {}
    },
    async list({ prefix }) {
      await load()

      const keys = [...values.keys()].filter((key) => {
        return prefix === undefined || key.startsWith(prefix)
      }).sort()

      return { keys }
    },
  }

  return { handlers, ready: load }
}

/**
 * Deletes every value the current viewer saved for this artifact, after
 * any write still in flight.
 */
export async function resetArtifactStorage(
  artifactId: string,
  shareToken?: string | null,
): Promise<void> {
  const request = createRequest(shareToken)

  await enqueueWrite(artifactId, async () => {
    await request(storagePath(artifactId), { method: 'DELETE' })
  })
}
