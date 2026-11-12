import type { GatewayId } from '#shared/types/gateways.d'
import { normalizeMediaType } from '#shared/utils/files'
import {
  isLegacyOfficeMediaType,
  isOfficeMediaType,
} from '#shared/utils/office-files'

export type FileDelivery = 'native' | 'text' | 'unsupported'

export type FileDeliveryReason
  = | 'model-no-image'
    | 'model-no-pdf'
    | 'office-unreadable'
    | 'legacy-office'
    | 'unsupported-type'

export type FileDeliveryRoute = 'direct' | GatewayId

export type OfficeDeliveryMode = 'extract' | 'native'

export interface FileDeliveryResult {
  delivery: FileDelivery
  reason?: FileDeliveryReason
}

export interface ResolveFileDeliveryInput {
  route: FileDeliveryRoute
  providerId?: string
  modalities?: readonly string[]
  mediaType: string
  textStatus?: string | null
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
 * fails open for images and PDFs, as the gateway checks always have.
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

    return input.textStatus === 'ready'
      ? { delivery: 'text' }
      : { delivery: 'unsupported', reason: 'office-unreadable' }
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
