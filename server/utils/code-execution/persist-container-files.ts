import type {
  CodeExecutionProvider,
  CodeExecutionSkipReason,
  CodeExecutionSkippedFile,
} from '#shared/utils/code-execution'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type { ContainerFileRef } from '~~/server/utils/code-execution/container-files'
import type { ContainerDocumentFormat } from '~~/server/utils/code-execution/document-validation'
import type { ProviderResourceTracker } from '~~/server/utils/code-execution/provider-cleanup'
import { CODE_EXECUTION_MAX_FILE_BYTES } from '#shared/utils/code-execution'
import { markUrlAsGeneratedFile } from '#shared/utils/files'
import { downloadContainerFile } from '~~/server/utils/code-execution/container-files'
import { checkContainerDocument } from '~~/server/utils/code-execution/document-validation'
import {
  resolveContainerFileType,
  sanitizeContainerFileName,
} from '~~/server/utils/code-execution/file-types'
import { markAiGeneratedImage } from '~~/server/utils/ai/image-provenance'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { persistFile } from '~~/server/utils/files/persist-file'

export interface SavedContainerFile {
  fileId: string
  url: string
  filename: string
  mediaType: string
  bytes: number
}

export interface PersistContainerFilesInput {
  refs: ContainerFileRef[]
  provider: CodeExecutionProvider
  modelId: string
  userId: number
  apiKey: string
  remainingFileSlots: number
  tracker: ProviderResourceTracker
  logger: LoggerLike
  fetcher?: typeof fetch
}

export interface PersistContainerFilesResult {
  saved: SavedContainerFile[]
  skipped: CodeExecutionSkippedFile[]
  provenanceMissing: number
}

const FALLBACK_SKIPPED_NAME = 'file'

function describeRef(ref: ContainerFileRef): string {
  return ref.provider === 'openai' && ref.filename
    ? sanitizeContainerFileName(ref.filename)
    : FALLBACK_SKIPPED_NAME
}

/**
 * Downloads, checks and stores the files a provider container produced.
 * Sequential on purpose. Every file passes the type allowlist and magic-byte
 * check; images get the AI marking, PDF and Office files go through the
 * document validation seam. A file that fails any step is skipped with a
 * reason and never aborts the others. Everything is saved as a private file
 * with `originProvider` and `originModel`, so the AI badge shows.
 */
export async function persistContainerFiles(
  input: PersistContainerFilesInput,
): Promise<PersistContainerFilesResult> {
  const result: PersistContainerFilesResult = {
    saved: [],
    skipped: [],
    provenanceMissing: 0,
  }

  function skip(filename: string, reason: CodeExecutionSkipReason) {
    result.skipped.push({ filename, reason })
  }

  for (const ref of input.refs) {
    if (ref.provider === 'anthropic') {
      input.tracker.trackFile(ref.fileId)
    }

    if (result.saved.length >= input.remainingFileSlots) {
      skip(describeRef(ref), 'limit-reached')

      continue
    }

    try {
      const download = await downloadContainerFile({
        ref,
        apiKey: input.apiKey,
        fetcher: input.fetcher,
      }, input.logger)

      if (!download.ok) {
        skip(describeRef(ref), download.reason)

        continue
      }

      const filename = sanitizeContainerFileName(
        download.filename ?? describeRef(ref),
      )
      const fileType = resolveContainerFileType(filename, download.bytes)

      if (!fileType.ok) {
        skip(filename, 'type-not-allowed')

        continue
      }

      let fileData = download.bytes
      const { type } = fileType

      if (type.kind === 'image') {
        fileData = markAiGeneratedImage({
          data: download.bytes,
          mediaType: type.mediaType as 'image/png' | 'image/jpeg' | 'image/webp',
          model: input.modelId,
          maxBytes: CODE_EXECUTION_MAX_FILE_BYTES,
        }).data
      }

      if (type.kind === 'pdf' || type.kind === 'office') {
        const check = await checkContainerDocument({
          format: type.extension as ContainerDocumentFormat,
          bytes: download.bytes,
          model: input.modelId,
        })

        if (!check.ok) {
          input.logger.set({
            attributes: {
              codeExecutionDocument: {
                format: type.extension,
                rejected: check.code,
              },
            },
          })
          skip(filename, 'validation-failed')

          continue
        }

        fileData = check.bytes

        if (check.provenance === 'missing') {
          result.provenanceMissing += 1
        }
      }

      try {
        const persisted = await persistFile({
          userId: input.userId,
          fileName: filename,
          mediaType: type.mediaType,
          fileData,
          source: 'assistant',
          originProvider: input.provider,
          originModel: input.modelId,
          logger: input.logger,
        })

        result.saved.push({
          fileId: persisted.id,
          url: markUrlAsGeneratedFile(`/files/${persisted.storageKey}`),
          filename,
          mediaType: type.mediaType,
          bytes: persisted.size,
        })
      } catch (exception) {
        input.logger.set({
          attributes: {
            codeExecutionPersist: { error: exceptionMessage(exception) },
          },
        })
        skip(filename, 'storage-failed')
      }
    } catch (exception) {
      input.logger.set({
        attributes: {
          codeExecutionPersist: { error: exceptionMessage(exception) },
        },
      })
      skip(describeRef(ref), 'validation-failed')
    }
  }

  return result
}
