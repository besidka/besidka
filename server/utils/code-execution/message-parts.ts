import type { UIMessage } from 'ai'
import type { CodeExecutionSkippedFile } from '#shared/utils/code-execution'
import {
  CODE_EXECUTION_FILES_PART_TYPE,
  CODE_EXECUTION_PART_TYPE,
  isDataCodeExecutionFilesPart,
} from '#shared/utils/code-execution'
import {
  compactCodeExecutionInput,
  compactCodeExecutionOutput,
} from '~~/server/utils/code-execution/compact'
import { isContainerFileCitationChunk } from '~~/server/utils/code-execution/container-files'

type MessagePart = UIMessage['parts'][number]

const METADATA_KEY = 'besidka'

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function compactToolPart(record: Record<string, unknown>): MessagePart | null {
  if (record.state === 'output-error') {
    return {
      type: CODE_EXECUTION_PART_TYPE,
      toolCallId: record.toolCallId,
      state: 'output-error',
      input: compactCodeExecutionInput(record.input),
      errorText: typeof record.errorText === 'string'
        ? record.errorText
        : 'The provider could not run the code.',
    } as unknown as MessagePart
  }

  if (record.state !== 'output-available') {
    return null
  }

  return {
    type: CODE_EXECUTION_PART_TYPE,
    toolCallId: record.toolCallId,
    state: 'output-available',
    input: compactCodeExecutionInput(record.input),
    output: compactCodeExecutionOutput(record.output).output,
  } as unknown as MessagePart
}

function restoreFileName(record: Record<string, unknown>): MessagePart {
  const metadata = readRecord(record.providerMetadata)
  const besidka = readRecord(metadata?.[METADATA_KEY])
  const filename = besidka?.filename

  if (typeof filename !== 'string') {
    return record as unknown as MessagePart
  }

  const restored: Record<string, unknown> = { ...record, filename }

  delete restored.providerMetadata

  return restored as unknown as MessagePart
}

/**
 * The persistence-side half of the code execution safety net. The stream
 * transform already compacts everything it forwards; this runs again on the
 * finished message so `messages.parts` can never hold more, whatever the
 * stream carried: unfinished runs (an interrupted stream) are dropped,
 * finished ones are compacted again (idempotent), OpenAI container file
 * citations (provider file and container ids) are removed, saved files get
 * their file name back from the stream marker, and the skipped-file notices
 * of every step are merged into one part.
 */
export function finalizeCodeExecutionParts(
  parts: UIMessage['parts'],
): UIMessage['parts'] {
  const finalized: UIMessage['parts'] = []
  const skipped: CodeExecutionSkippedFile[] = []
  let savedCount = 0
  let noticeIndex = -1

  for (const part of parts) {
    const record = readRecord(part)

    if (!record) {
      finalized.push(part)

      continue
    }

    if (record.type === CODE_EXECUTION_PART_TYPE) {
      const compacted = compactToolPart(record)

      if (compacted) {
        finalized.push(compacted)
      }

      continue
    }

    if (
      record.type === 'source-document'
      && isContainerFileCitationChunk(record)
    ) {
      continue
    }

    if (record.type === 'file') {
      finalized.push(restoreFileName(record))

      continue
    }

    if (isDataCodeExecutionFilesPart(part)) {
      skipped.push(...part.data.skipped)
      savedCount += part.data.savedCount

      if (noticeIndex === -1) {
        noticeIndex = finalized.length
        finalized.push(part)
      }

      continue
    }

    finalized.push(part)
  }

  if (noticeIndex !== -1) {
    finalized[noticeIndex] = {
      type: CODE_EXECUTION_FILES_PART_TYPE,
      data: { savedCount, skipped },
    } as unknown as MessagePart
  }

  return finalized
}
