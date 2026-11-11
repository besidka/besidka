import type { UIMessageChunk } from 'ai'
import type { CodeExecutionProvider } from '#shared/utils/code-execution'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type { CodeExecutionRates } from '~~/server/utils/ai/code-execution-cost'
import type { ContainerFileRef } from '~~/server/utils/code-execution/container-files'
import type { ProviderResourceTracker } from '~~/server/utils/code-execution/provider-cleanup'
import {
  CODE_EXECUTION_FILES_PART_TYPE,
  CODE_EXECUTION_MAX_OUTPUT_FILES,
  CODE_EXECUTION_TOOL_NAME,
} from '#shared/utils/code-execution'
import { describeCodeExecutionUsage } from '~~/server/utils/ai/code-execution-cost'
import {
  compactCodeExecutionInput,
  compactCodeExecutionOutput,
} from '~~/server/utils/code-execution/compact'
import {
  collectAnthropicContainerFileRefs,
  getContainerFileKey,
  isContainerFileCitationChunk,
  readOpenAiContainerFileCitation,
} from '~~/server/utils/code-execution/container-files'
import { persistContainerFiles } from '~~/server/utils/code-execution/persist-container-files'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export const BESIDKA_FILE_METADATA_KEY = 'besidka'

export interface CreateCodeExecutionStreamInput {
  provider: CodeExecutionProvider
  modelId: string
  userId: number
  apiKey: string
  filesEnabled: boolean
  tracker: ProviderResourceTracker
  rates: CodeExecutionRates
  logger: LoggerLike
  persistFiles?: typeof persistContainerFiles
  fetcher?: typeof fetch
}

export interface CodeExecutionStream {
  apply: (
    stream: ReadableStream<UIMessageChunk>,
  ) => ReadableStream<UIMessageChunk>
  getSavedFileIds: () => string[]
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * Sits between the AI SDK UI stream and its two consumers (the client and the
 * persistence reader), so both see the same, already safe chunks:
 *
 * - the code and output of each run are reduced to the compact form (32 KB
 *   caps, no encrypted payload, no provider file ids or container ids);
 * - the files a run produced are collected (Anthropic result ids, OpenAI
 *   citation chunks), downloaded with the user's key at the end of each step,
 *   checked and stored, and announced as ordinary `file` chunks plus one
 *   `data-code-execution-files` chunk for the ones that were skipped;
 * - at the end of the send everything Besidka created at the provider is
 *   deleted, on success and failure, and the usage is logged.
 */
export function createCodeExecutionStream(
  input: CreateCodeExecutionStreamInput,
): CodeExecutionStream {
  const persistFiles = input.persistFiles ?? persistContainerFiles
  const codeToolCallIds = new Set<string>()
  const pendingRefs = new Map<string, ContainerFileRef>()
  const seenRefs = new Set<string>()
  const containerIds = new Set<string>()
  const savedFileIds: string[] = []
  const usage = {
    calls: 0,
    files: 0,
    bytes: 0,
    skipped: 0,
    provenanceMissing: 0,
  }
  let isFinished = false

  function addRef(ref: ContainerFileRef) {
    const key = getContainerFileKey(ref)

    if (seenRefs.has(key)) {
      return
    }

    seenRefs.add(key)
    pendingRefs.set(key, ref)

    if (ref.provider === 'openai') {
      containerIds.add(ref.containerId)
      input.tracker.trackContainer(ref.containerId)
    } else {
      input.tracker.trackFile(ref.fileId)
    }
  }

  async function persistFilesSafely(
    refs: ContainerFileRef[],
  ): Promise<Awaited<ReturnType<typeof persistContainerFiles>>> {
    try {
      return await persistFiles({
        refs,
        provider: input.provider,
        modelId: input.modelId,
        userId: input.userId,
        apiKey: input.apiKey,
        remainingFileSlots: CODE_EXECUTION_MAX_OUTPUT_FILES - usage.files,
        tracker: input.tracker,
        logger: input.logger,
        fetcher: input.fetcher,
      })
    } catch (exception) {
      input.logger.set({
        attributes: {
          codeExecutionPersist: { error: exceptionMessage(exception) },
        },
      })

      return {
        saved: [],
        skipped: refs.map((ref) => {
          return {
            filename: ref.provider === 'openai' && ref.filename
              ? ref.filename
              : 'file',
            reason: 'download-failed' as const,
          }
        }),
        provenanceMissing: 0,
      }
    }
  }

  async function flushPendingFiles(
    controller: TransformStreamDefaultController<UIMessageChunk>,
  ) {
    const refs = [...pendingRefs.values()]

    pendingRefs.clear()

    if (refs.length === 0) {
      return
    }

    if (!input.filesEnabled) {
      return
    }

    const result = await persistFilesSafely(refs)

    for (const file of result.saved) {
      savedFileIds.push(file.fileId)
      usage.files += 1
      usage.bytes += file.bytes
      controller.enqueue({
        type: 'file',
        url: file.url,
        mediaType: file.mediaType,
        providerMetadata: {
          [BESIDKA_FILE_METADATA_KEY]: { filename: file.filename },
        },
      })
    }

    usage.skipped += result.skipped.length
    usage.provenanceMissing += result.provenanceMissing

    if (result.skipped.length > 0) {
      controller.enqueue({
        type: CODE_EXECUTION_FILES_PART_TYPE,
        data: {
          savedCount: result.saved.length,
          skipped: result.skipped,
        },
      } as UIMessageChunk)
    }
  }

  function discardPendingRefs() {
    pendingRefs.clear()
  }

  async function finishSend() {
    if (isFinished) {
      return
    }

    isFinished = true
    input.logger.set({
      attributes: {
        codeExecution: {
          ...describeCodeExecutionUsage({
            provider: input.provider,
            calls: usage.calls,
            containers: containerIds.size,
            files: usage.files,
            bytes: usage.bytes,
            skipped: usage.skipped,
          }, input.rates),
          provenanceMissing: usage.provenanceMissing,
        },
      },
    })
  }

  function handleToolChunk(
    chunk: UIMessageChunk,
  ): UIMessageChunk | null | undefined {
    if (chunk.type === 'tool-input-start') {
      if (chunk.toolName === CODE_EXECUTION_TOOL_NAME) {
        codeToolCallIds.add(chunk.toolCallId)
      }

      return undefined
    }

    if (chunk.type === 'tool-input-available') {
      if (chunk.toolName !== CODE_EXECUTION_TOOL_NAME) {
        return undefined
      }

      codeToolCallIds.add(chunk.toolCallId)

      const containerId = readRecord(chunk.input)?.containerId

      if (typeof containerId === 'string') {
        containerIds.add(containerId)
        input.tracker.trackContainer(containerId)
      }

      return { ...chunk, input: compactCodeExecutionInput(chunk.input) }
    }

    if (
      chunk.type === 'tool-output-available'
      && codeToolCallIds.has(chunk.toolCallId)
    ) {
      usage.calls += 1

      if (input.provider === 'anthropic') {
        for (const ref of collectAnthropicContainerFileRefs(chunk.output)) {
          addRef(ref)
        }
      }

      const compacted = compactCodeExecutionOutput(chunk.output)

      if (compacted.errorText) {
        return {
          type: 'tool-output-error',
          toolCallId: chunk.toolCallId,
          errorText: compacted.errorText,
          providerExecuted: chunk.providerExecuted,
        }
      }

      return { ...chunk, output: compacted.output }
    }

    if (
      chunk.type === 'tool-output-error'
      && codeToolCallIds.has(chunk.toolCallId)
    ) {
      usage.calls += 1
    }

    return undefined
  }

  const transform = new TransformStream<UIMessageChunk, UIMessageChunk>({
    async transform(chunk, controller) {
      if (
        chunk.type === 'source-document'
        && isContainerFileCitationChunk(chunk)
      ) {
        const ref = readOpenAiContainerFileCitation(chunk)

        if (ref) {
          addRef(ref)
        }

        return
      }

      const replacement = handleToolChunk(chunk)

      if (chunk.type === 'finish-step' || chunk.type === 'finish') {
        await flushPendingFiles(controller)

        if (chunk.type === 'finish') {
          await finishSend()
        }
      }

      if (chunk.type === 'abort' || chunk.type === 'error') {
        discardPendingRefs()
      }

      controller.enqueue(replacement ?? chunk)
    },
    async flush() {
      discardPendingRefs()
      await finishSend()
      await input.tracker.cleanup()
    },
  })

  return {
    apply(stream) {
      return stream.pipeThrough(transform)
    },
    getSavedFileIds() {
      return [...savedFileIds]
    },
  }
}
