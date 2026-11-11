import { ERROR_CODES, RpcError } from '@besidka/artifacts-protocol'
import type {
  CompleteParams,
  CompleteResult,
} from '@besidka/artifacts-protocol'
import type {
  ArtifactBridgeCompletion,
  ArtifactBridgeInfo,
} from '#shared/utils/artifacts'
import {
  ARTIFACT_BRIDGE_DEFAULT_OUTPUT_TOKENS,
  ARTIFACT_BRIDGE_NO_KEY_CODE,
} from '#shared/utils/artifacts'
import { parseError } from 'evlog'
import type { ArtifactPanelSource } from '~/composables/artifacts'
import { ARTIFACT_SHARE_HEADER } from '~/composables/artifact-storage'

export interface ArtifactBridgeModeInput {
  loggedIn: boolean
  featureActive: boolean
  source: ArtifactPanelSource
  artifactId: string | null | undefined
}

export interface ArtifactBridgeError {
  message: string
  why?: string
  link?: string
}

export interface PendingArtifactCompletion {
  artifactId: string
  title: string
  prompt: string
  system?: string
  maxOutputTokens: number
  allowRemember: boolean
  info: ArtifactBridgeInfo | null
  infoError: ArtifactBridgeError | null
  isLoadingInfo: boolean
  isRunning: boolean
  error: ArtifactBridgeError | null
  lastFailure: RpcError | null
}

interface ArtifactBridgeOptions {
  artifactId: () => string | null | undefined
  title: () => string
  source: () => ArtifactPanelSource
  shareToken?: () => string | null | undefined
}

interface PendingHandle {
  resolve: (result: CompleteResult) => void
  reject: (error: RpcError) => void
}

/**
 * `complete()` is offered only to a signed-in viewer with the
 * `artifacts.llm-bridge` flag (and its Labs opt-in), for a saved artifact
 * opened from their own chat. Shared chats get no bridge until artifact
 * share links (A-7) let the owner allow it per link.
 */
export function resolveArtifactBridgeEnabled(
  input: ArtifactBridgeModeInput,
): boolean {
  return input.loggedIn
    && input.featureActive
    && input.source === 'owner'
    && !!input.artifactId
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

function readReason(exception: unknown): string | null {
  const data = (exception as { data?: { data?: { reason?: unknown } } })
    ?.data?.data

  return typeof data?.reason === 'string' ? data.reason : null
}

/**
 * Maps a failed bridge route to the JSON-RPC error the runtime shows to
 * artifact code. Server text never reaches the artifact: the runtime has its
 * own message per code.
 */
export function toBridgeRpcError(exception: unknown): RpcError {
  const status = readStatus(exception)
  const reason = readReason(exception)

  if (status === 429) {
    return new RpcError(ERROR_CODES.rateLimited, 'Too many AI requests')
  }

  if (
    status === 403
    && (reason === 'legal-consent' || reason === 'transfer-consent')
  ) {
    return new RpcError(ERROR_CODES.consentRequired, 'Consent required')
  }

  if (status >= 400 && status < 500) {
    return new RpcError(ERROR_CODES.notAllowed, 'AI request not allowed')
  }

  return new RpcError(ERROR_CODES.internalError, 'AI request failed')
}

function toBridgeError(exception: unknown): ArtifactBridgeError {
  const parsed = parseError(exception)
  const reason = readReason(exception)

  return {
    message: reason === ARTIFACT_BRIDGE_NO_KEY_CODE
      ? 'This needs a direct provider key'
      : parsed.message || 'The AI request failed',
    why: parsed.why,
    link: parsed.link,
  }
}

function declined(): RpcError {
  return new RpcError(ERROR_CODES.declinedByViewer, 'Declined by the viewer')
}

/**
 * The parent side of `window.besidka.complete()`. Every call waits for the
 * viewer in a confirmation modal that shows the full prompt and system
 * text, unless the viewer ticked "Don't ask again" for this artifact in
 * this panel session (owner chats only; forgotten when the frame closes).
 * One request is held at a time: a second call while the modal is open is
 * refused as rate-limited, and closing the frame declines the open one.
 */
export function useArtifactBridge(options: ArtifactBridgeOptions) {
  const pending = shallowRef<PendingArtifactCompletion | null>(null)
  let handle: PendingHandle | null = null
  let rememberedModelId: string | null = null
  let isBusy = false
  let generation = 0

  function headers(): Record<string, string> {
    const token = options.shareToken?.()

    return token ? { [ARTIFACT_SHARE_HEADER]: token } : {}
  }

  function patchPending(changes: Partial<PendingArtifactCompletion>) {
    if (pending.value) {
      pending.value = { ...pending.value, ...changes }
    }
  }

  async function requestCompletion(
    artifactId: string,
    params: CompleteParams,
    modelId: string,
  ): Promise<ArtifactBridgeCompletion> {
    return await $fetch(
      `/api/v1/artifacts/${encodeURIComponent(artifactId)}/complete`,
      {
        method: 'POST',
        headers: headers(),
        body: {
          prompt: params.prompt,
          ...(params.system ? { system: params.system } : {}),
          modelId,
          maxOutputTokens: params.maxOutputTokens
            ?? ARTIFACT_BRIDGE_DEFAULT_OUTPUT_TOKENS,
        },
      },
    ) as ArtifactBridgeCompletion
  }

  async function loadInfo(artifactId: string) {
    try {
      const info = await $fetch(
        `/api/v1/artifacts/${encodeURIComponent(artifactId)}/bridge`,
        { headers: headers() },
      ) as ArtifactBridgeInfo

      patchPending({ info, isLoadingInfo: false })
    } catch (exception) {
      patchPending({
        infoError: toBridgeError(exception),
        isLoadingInfo: false,
        lastFailure: toBridgeRpcError(exception),
      })
    }
  }

  function settle() {
    pending.value = null
    handle = null
    isBusy = false
  }

  async function complete(params: CompleteParams): Promise<CompleteResult> {
    const artifactId = options.artifactId()

    if (!artifactId) {
      throw new RpcError(ERROR_CODES.notAllowed, 'Artifact not saved')
    }

    if (isBusy) {
      throw new RpcError(ERROR_CODES.rateLimited, 'Another request is open')
    }

    if (rememberedModelId) {
      const callGeneration = generation

      isBusy = true

      try {
        const result = await requestCompletion(
          artifactId,
          params,
          rememberedModelId,
        )

        return { text: result.text }
      } catch (exception) {
        if (callGeneration === generation) {
          rememberedModelId = null
        }

        throw toBridgeRpcError(exception)
      } finally {
        if (callGeneration === generation) {
          isBusy = false
        }
      }
    }

    isBusy = true

    return await new Promise<CompleteResult>((resolve, reject) => {
      handle = { resolve, reject }
      pending.value = {
        artifactId,
        title: options.title(),
        prompt: params.prompt,
        system: params.system,
        maxOutputTokens: params.maxOutputTokens
          ?? ARTIFACT_BRIDGE_DEFAULT_OUTPUT_TOKENS,
        allowRemember: options.source() === 'owner',
        info: null,
        infoError: null,
        isLoadingInfo: true,
        isRunning: false,
        error: null,
        lastFailure: null,
      }
      loadInfo(artifactId)
    })
  }

  async function allow(modelId: string, remember: boolean) {
    const current = pending.value
    const currentHandle = handle

    if (!current || !currentHandle || current.isRunning) {
      return
    }

    patchPending({ isRunning: true, error: null })

    try {
      const result = await requestCompletion(
        current.artifactId,
        {
          prompt: current.prompt,
          system: current.system,
          maxOutputTokens: current.maxOutputTokens,
        },
        modelId,
      )

      if (handle !== currentHandle) {
        return
      }

      if (remember && current.allowRemember) {
        rememberedModelId = modelId
      }

      currentHandle.resolve({ text: result.text })
      settle()
    } catch (exception) {
      if (handle !== currentHandle) {
        return
      }

      patchPending({
        isRunning: false,
        error: toBridgeError(exception),
        lastFailure: toBridgeRpcError(exception),
      })
    }
  }

  function cancel() {
    const current = pending.value

    if (!handle) {
      return
    }

    if (current?.isRunning) {
      return
    }

    handle.reject(current?.lastFailure ?? declined())
    settle()
  }

  function dispose() {
    generation += 1
    handle?.reject(declined())
    settle()
    rememberedModelId = null
  }

  return { pending, complete, allow, cancel, dispose }
}
