import type { GatewayId } from '#shared/types/gateways.d'
import { normalizeMediaType } from '#shared/utils/files'
import {
  OFFICE_MEDIA_TYPES,
  isLegacyOfficeMediaType,
  isOfficeMediaType,
} from '#shared/utils/office-files'

export type FileDelivery = 'native' | 'text' | 'container' | 'unsupported'

export type FileDeliveryReason
  = | 'model-no-image'
    | 'model-no-pdf'
    | 'office-unreadable'
    | 'legacy-office'
    | 'unsupported-type'

export type FileDeliveryRoute = 'direct' | GatewayId

export type OfficeDeliveryMode = 'extract' | 'native'

export type ContainerDeliveryMode = 'upload' | 'inline'

export interface FileDeliveryResult {
  delivery: FileDelivery
  reason?: FileDeliveryReason
  container?: ContainerDeliveryMode
}

export interface ResolveFileDeliveryInput {
  route: FileDeliveryRoute
  providerId?: string
  modalities?: readonly string[]
  mediaType: string
  textStatus?: string | null
  codeExecutionFiles?: boolean
}

/**
 * The non-text, non-image types the provider code-execution container reads
 * that chat does not otherwise deliver. The allowlist is
 * `server/utils/code-execution/file-types.ts`; a spec keeps the two in step.
 */
export const CODE_EXECUTION_CONTAINER_MEDIA_TYPES: readonly string[] = [
  ...Object.values(OFFICE_MEDIA_TYPES),
  'application/json',
]

/**
 * How "Run code" hands a message's files to each provider's sandbox:
 * `upload` puts them in the provider's file store before the call and passes
 * ids (the model message carries no file part), `inline` leaves them as file
 * parts in the model message (Gemini takes attachments inline).
 */
export const CODE_EXECUTION_FILE_DELIVERY: Readonly<
  Record<string, ContainerDeliveryMode>
> = {
  anthropic: 'upload',
  openai: 'upload',
  google: 'inline',
}

/**
 * How each route handles Office files. Every row is `extract` because the
 * text is read once when the file is stored and sent as a text part: it works
 * the same on every provider, survives a model switch, and the one provider
 * that reads Office files natively (OpenAI Responses) returns text only.
 * Flipping a row to `native` is the seam for enabling that path later.
 */
export const DIRECT_PROVIDER_OFFICE_DELIVERY: Readonly<
  Record<string, OfficeDeliveryMode>
> = {
  anthropic: 'extract',
  openai: 'extract',
  google: 'extract',
  xai: 'extract',
  deepseek: 'extract',
  moonshotai: 'extract',
  qwen: 'extract',
}

export const GATEWAY_OFFICE_DELIVERY: Readonly<
  Record<GatewayId, OfficeDeliveryMode>
> = {
  vercel: 'extract',
  openrouter: 'extract',
  cloudflare: 'extract',
}

function getOfficeDeliveryMode(
  route: FileDeliveryRoute,
  providerId: string | undefined,
): OfficeDeliveryMode {
  if (route !== 'direct') {
    return GATEWAY_OFFICE_DELIVERY[route] ?? 'extract'
  }

  return (providerId && DIRECT_PROVIDER_OFFICE_DELIVERY[providerId])
    || 'extract'
}

function getContainerMode(
  input: ResolveFileDeliveryInput,
  mediaType: string,
): ContainerDeliveryMode | undefined {
  if (
    !input.codeExecutionFiles
    || input.route !== 'direct'
    || !input.providerId
    || !CODE_EXECUTION_CONTAINER_MEDIA_TYPES.includes(mediaType)
  ) {
    return undefined
  }

  return CODE_EXECUTION_FILE_DELIVERY[input.providerId]
}

function resolveMediaDelivery(
  kind: 'image' | 'pdf',
  modalities: readonly string[] | undefined,
): FileDeliveryResult {
  if (!modalities || modalities.includes(kind)) {
    return { delivery: 'native' }
  }

  return {
    delivery: 'unsupported',
    reason: kind === 'image' ? 'model-no-image' : 'model-no-pdf',
  }
}

/**
 * The single answer to "how does this file reach the model". It is total:
 * any media type it does not know is `unsupported`, never an exception, so
 * the send path can turn the result into a 400 instead of letting a provider
 * throw or silently drop the part. `modalities` is the model's input list
 * (`image`, `pdf`); an unknown list (`undefined`, a gateway catalog miss)
 * fails open for images and PDFs, as the gateway checks always have. With
 * `codeExecutionFiles` (a direct Anthropic, OpenAI or Google send with "Run
 * code" and `code-execution.files` on) an Office or JSON file also reaches
 * the sandbox: `container` when the model gets no text of it, and a
 * `container` mode on the result either way so the caller knows whether the
 * file part stays in the model message (`inline`) or is uploaded (`upload`).
 */
export function resolveFileDelivery(
  input: ResolveFileDeliveryInput,
): FileDeliveryResult {
  const mediaType = normalizeMediaType(input.mediaType)

  if (mediaType.startsWith('text/')) {
    return { delivery: 'text' }
  }

  if (mediaType.startsWith('image/')) {
    return resolveMediaDelivery('image', input.modalities)
  }

  if (mediaType === 'application/pdf') {
    return resolveMediaDelivery('pdf', input.modalities)
  }

  if (isLegacyOfficeMediaType(mediaType)) {
    return { delivery: 'unsupported', reason: 'legacy-office' }
  }

  if (isOfficeMediaType(mediaType)) {
    if (getOfficeDeliveryMode(input.route, input.providerId) === 'native') {
      return { delivery: 'native' }
    }

    const container = getContainerMode(input, mediaType)

    if (input.textStatus === 'ready') {
      return container ? { delivery: 'text', container } : { delivery: 'text' }
    }

    return container
      ? { delivery: 'container', container }
      : { delivery: 'unsupported', reason: 'office-unreadable' }
  }

  const container = getContainerMode(input, mediaType)

  if (container) {
    return { delivery: 'container', container }
  }

  return { delivery: 'unsupported', reason: 'unsupported-type' }
}

export function describeFileDeliveryReason(
  reason: FileDeliveryReason | undefined,
): { why: string, fix: string } {
  switch (reason) {
    case 'model-no-image':
      return {
        why: 'The selected model does not advertise image support.',
        fix: 'Remove the image, or switch to a vision-capable model.',
      }
    case 'model-no-pdf':
      return {
        why: 'The selected model does not advertise PDF support.',
        fix: 'Remove the PDF, attach its text as a .txt file, or switch to a model that reads PDFs.',
      }
    case 'legacy-office':
      return {
        why: 'Legacy Word, Excel and PowerPoint files (.doc, .xls, .ppt) cannot be read.',
        fix: 'Save the file as .docx, .xlsx or .pptx and attach that.',
      }
    case 'office-unreadable':
      return {
        why: 'No text could be read from this document. It may be empty, protected, damaged or too large.',
        fix: 'Open it, check it has text, save it as .docx, .xlsx or .pptx and attach it again.',
      }
    default:
      return {
        why: 'This file type cannot be sent to a model.',
        fix: 'Remove the file, or attach it as PDF, an image or plain text.',
      }
  }
}
