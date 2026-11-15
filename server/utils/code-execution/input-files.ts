import type { CodeExecutionProvider } from '#shared/utils/code-execution'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type { ProviderResourceTracker } from '~~/server/utils/code-execution/provider-cleanup'
import {
  CODE_EXECUTION_MAX_INPUT_BYTES,
  CODE_EXECUTION_MAX_INPUT_FILES,
} from '#shared/utils/code-execution'
import {
  buildAuthHeaders,
} from '~~/server/utils/code-execution/container-files'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export const INPUT_FILE_UPLOAD_TIMEOUT_MS = 60_000
export const INPUT_FILE_EXPIRY_SECONDS = 3600

const UPLOAD_URLS: Record<'anthropic' | 'openai', string> = {
  anthropic: 'https://api.anthropic.com/v1/files',
  openai: 'https://api.openai.com/v1/files',
}
const OPENAI_UPLOAD_PURPOSE = 'user_data'

export interface CodeExecutionInputFile {
  name: string
  mediaType: string
  bytes: Uint8Array
}

export interface UploadInputFilesInput {
  provider: CodeExecutionProvider
  apiKey: string
  files: CodeExecutionInputFile[]
  tracker: ProviderResourceTracker
  logger: LoggerLike
  fetcher?: typeof fetch
}

export interface UploadedInputFile {
  fileId: string
  name: string
  mediaType: string
}

export function selectInputFiles<
  TFile extends { bytes: Uint8Array },
>(files: TFile[]): TFile[] {
  const selected: TFile[] = []
  let totalBytes = 0

  for (const file of files) {
    if (selected.length >= CODE_EXECUTION_MAX_INPUT_FILES) {
      break
    }

    if (totalBytes + file.bytes.byteLength > CODE_EXECUTION_MAX_INPUT_BYTES) {
      continue
    }

    totalBytes += file.bytes.byteLength
    selected.push(file)
  }

  return selected
}

function buildUploadForm(
  provider: 'anthropic' | 'openai',
  file: CodeExecutionInputFile,
): FormData {
  const form = new FormData()

  form.append(
    'file',
    new Blob([file.bytes as BlobPart], { type: file.mediaType }),
    file.name,
  )

  if (provider === 'anthropic') {
    form.append('expires_in_seconds', String(INPUT_FILE_EXPIRY_SECONDS))
  } else {
    form.append('purpose', OPENAI_UPLOAD_PURPOSE)
    form.append('expires_after[anchor]', 'created_at')
    form.append('expires_after[seconds]', String(INPUT_FILE_EXPIRY_SECONDS))
  }

  return form
}

/**
 * Uploads the attachments of the current message to the provider so its
 * sandbox can read them, with the user's own key. Anthropic uploads carry
 * `expires_in_seconds: 3600` and OpenAI uploads an hour of `expires_after`,
 * as a backstop for a Worker that never reaches its cleanup. Every uploaded
 * id is registered with the tracker at once, so it is deleted at the end of
 * the send whether the send succeeded or failed. A file that fails to upload
 * is skipped; Gemini takes its input inline and never reaches this function.
 */
export async function uploadInputFiles(
  input: UploadInputFilesInput,
): Promise<UploadedInputFile[]> {
  if (input.provider === 'google') {
    return []
  }

  const fetcher = input.fetcher ?? fetch
  const url = UPLOAD_URLS[input.provider]
  const uploaded: UploadedInputFile[] = []

  for (const file of selectInputFiles(input.files)) {
    try {
      const response = await fetcher(url, {
        method: 'POST',
        headers: buildAuthHeaders(input.provider, input.apiKey),
        body: buildUploadForm(input.provider, file),
        redirect: 'manual',
        signal: AbortSignal.timeout(INPUT_FILE_UPLOAD_TIMEOUT_MS),
      })

      if (!response.ok) {
        await response.body?.cancel()
        input.logger.set({
          attributes: {
            codeExecutionUpload: {
              provider: input.provider,
              status: response.status,
            },
          },
        })

        continue
      }

      const body = await response.json() as { id?: unknown }

      if (typeof body.id !== 'string' || !body.id) {
        continue
      }

      input.tracker.trackFile(body.id)
      uploaded.push({
        fileId: body.id,
        name: file.name,
        mediaType: file.mediaType,
      })
    } catch (exception) {
      input.logger.set({
        attributes: {
          codeExecutionUpload: {
            provider: input.provider,
            error: exceptionMessage(exception),
          },
        },
      })
    }
  }

  return uploaded
}
