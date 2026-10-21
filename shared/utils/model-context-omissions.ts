import type { UIMessage } from 'ai'
import type {
  ModelContextOmissionReason,
  ModelContextOmittedFile,
  OmittedContextFilesData,
} from '#shared/types/model-context.d'

type MessagePart = UIMessage['parts'][number]

export const OMITTED_CONTEXT_FILES_PART_TYPE = 'data-omitted-context-files'

export function isOmittedContextFilesPart(
  part: MessagePart,
): part is MessagePart & { data: OmittedContextFilesData } {
  if (part.type !== OMITTED_CONTEXT_FILES_PART_TYPE) {
    return false
  }

  const data = (part as { data?: unknown }).data

  return typeof data === 'object'
    && data !== null
    && Array.isArray((data as { files?: unknown }).files)
}

export function getOmittedContextFiles(
  message: Pick<UIMessage, 'parts'>,
): OmittedContextFilesData | null {
  const part = message.parts?.find(isOmittedContextFilesPart)

  if (!part || part.data.files.length === 0) {
    return null
  }

  return part.data
}

export function getModelContextOmissionLabel(
  reason: ModelContextOmissionReason,
  modelName?: string,
): string {
  switch (reason) {
    case 'unsupported-by-model':
      return `${modelName || 'The selected model'} can't read this file type`
    case 'outside-window':
      return 'Attached too many messages ago'
    case 'over-limit':
      return 'Over the size or count limit for earlier files'
    case 'gateway-no-carry':
      return 'Gateway models only see files from the latest message'
  }
}

export function getOmittedContextFilesSummary(count: number): string {
  if (count === 1) {
    return '1 earlier file wasn\'t sent to the model'
  }

  return `${count} earlier files weren't sent to the model`
}

export function getOmittedContextFileName(
  file: ModelContextOmittedFile,
): string {
  return file.filename || 'Unnamed file'
}
