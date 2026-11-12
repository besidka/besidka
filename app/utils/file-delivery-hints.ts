import type { Model } from '#shared/types/providers.d'
import type { ModelSelection } from '#shared/types/model-selection.d'
import type { GatewayModel } from '#shared/types/gateways.d'
import type {
  FileDeliveryReason,
  FileDeliveryResult,
  ResolveFileDeliveryInput,
} from '#shared/utils/file-delivery'
import {
  describeFileDeliveryReason,
  resolveFileDelivery,
} from '#shared/utils/file-delivery'
import { getModelInputModalities } from '#shared/utils/model'
import {
  OFFICE_TEXT_INLINE_MAX_BYTES,
  isOfficeMediaType,
} from '#shared/utils/office-files'
import { getUnsupportedInputMessage } from '~/utils/files'

export interface DeliveryFile {
  type: string
  name?: string
  textStatus?: string | null
  textBytes?: number | null
  textTruncated?: boolean
  textOmittedMedia?: number | null
  textOmittedCharts?: number | null
}

export type FileDeliveryContext = Pick<
  ResolveFileDeliveryInput,
  'route' | 'providerId' | 'modalities' | 'codeExecutionFiles'
>

export type FileDeliveryResolver = (file: DeliveryFile) => FileDeliveryResult

export interface FileDeliveryHint {
  label: string
  description: string
  isBlocking: boolean
}

export interface FileRejection {
  reason: FileDeliveryReason | undefined
  type: string
  name?: string
}

export const TEXT_ONLY_DESCRIPTION
  = 'The model gets this file\'s text only. Images, charts and formatting aren\'t sent.'

export const TEXT_SHORTENED_LABEL = 'Shortened'

export const TEXT_SHORTENED_DESCRIPTION
  = 'It is long, so only the start is sent.'

export const OMITTED_COUNT_DISPLAY_MAX = 99

export const NEEDS_RUN_CODE_LABEL = 'Needs Run code'

export const NEEDS_RUN_CODE_DESCRIPTION
  = 'Turn on Run code to send this file, or remove it.'

const TERMINAL_TEXT_STATUSES: readonly string[] = [
  'empty',
  'failed',
  'too_large',
]

/**
 * A stored Office file with no text status yet (older files, or a renderer
 * that was down at upload) is read once by the server on the first send, so
 * the client treats it as readable and only the terminal statuses block it.
 */
export function getClientTextStatus(file: DeliveryFile): string {
  if (file.textStatus && TERMINAL_TEXT_STATUSES.includes(file.textStatus)) {
    return file.textStatus
  }

  return 'ready'
}

const FAIL_OPEN_INPUT_MODALITIES = ['image', 'pdf']

interface FileDeliveryContextSource {
  selection: ModelSelection
  model: Model | null
  providerId?: string
  gatewayModel?: Pick<GatewayModel, 'modalities'> | null
  codeExecutionFiles?: boolean
}

/**
 * The resolver inputs for the selected model, built the way the send route
 * builds them. A direct model uses its own input list (an unknown list fails
 * open); a gateway model has no curated list, so images follow the gateway
 * catalog (unknown counts as supported) and PDFs are always accepted, the
 * same two checks the server runs for gateway sends. `codeExecutionFiles`
 * is the send's "Run code with files" state: with it on, an Office or JSON
 * file that reaches the model as no text still reaches the sandbox.
 */
export function getFileDeliveryContext(
  source: FileDeliveryContextSource,
): FileDeliveryContext {
  const {
    selection,
    model,
    providerId,
    gatewayModel,
    codeExecutionFiles,
  } = source

  if (selection.source === 'gateway') {
    const isGatewayImageSupported
      = gatewayModel?.modalities?.input?.includes('image') ?? true

    return {
      route: selection.gatewayId,
      modalities: isGatewayImageSupported ? ['image', 'pdf'] : ['pdf'],
      codeExecutionFiles,
    }
  }

  return {
    route: 'direct',
    providerId,
    modalities: model?.modalities
      ? getModelInputModalities(model)
      : FAIL_OPEN_INPUT_MODALITIES,
    codeExecutionFiles,
  }
}

export function buildFileDeliveryInput(
  context: FileDeliveryContext,
  file: DeliveryFile,
): ResolveFileDeliveryInput {
  return {
    route: context.route,
    providerId: context.providerId,
    modalities: context.modalities,
    codeExecutionFiles: context.codeExecutionFiles,
    mediaType: file.type,
    textStatus: getClientTextStatus(file),
  }
}

export function createFileDeliveryResolver(
  context: FileDeliveryContext,
): FileDeliveryResolver {
  return (file) => {
    return resolveFileDelivery(buildFileDeliveryInput(context, file))
  }
}

/**
 * A resolver for callers that only know the model through a media-type
 * predicate (image and PDF support), so they keep working without the full
 * selection.
 */
export function createPredicateDeliveryResolver(
  canAttachMediaType: (mediaType: string) => boolean,
): FileDeliveryResolver {
  const modalities = [
    ...canAttachMediaType('image/png') ? ['image'] : [],
    ...canAttachMediaType('application/pdf') ? ['pdf'] : [],
  ]

  return createFileDeliveryResolver({ route: 'direct', modalities })
}

export function isTextTruncated(file: DeliveryFile): boolean {
  if (typeof file.textTruncated === 'boolean') {
    return file.textTruncated
  }

  return typeof file.textBytes === 'number'
    && file.textBytes > OFFICE_TEXT_INLINE_MAX_BYTES
}

function needsRunCode(
  file: DeliveryFile,
  resolveWithRunCode: FileDeliveryResolver | undefined,
): boolean {
  return resolveWithRunCode?.(file).delivery === 'container'
}

function formatOmittedCount(
  count: number | null | undefined,
  singular: string,
  plural: string,
): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) {
    return null
  }

  if (count >= OMITTED_COUNT_DISPLAY_MAX) {
    return `${OMITTED_COUNT_DISPLAY_MAX}+ ${plural}`
  }

  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * The note for an Office file whose text leaves something out: the model
 * gets the text only, so images, charts and diagrams are not sent, and a
 * long text is cut to its start. A file where nothing is lost (or the counts
 * are not known yet) gets none, so a normal file shows nothing.
 */
export function getTextLossNote(
  file: DeliveryFile,
): Pick<FileDeliveryHint, 'label' | 'description'> | null {
  const isShortened = isTextTruncated(file)
  const omitted = [
    formatOmittedCount(file.textOmittedMedia, 'image', 'images'),
    formatOmittedCount(file.textOmittedCharts, 'chart', 'charts'),
  ].filter((part): part is string => part !== null)

  if (!isShortened && omitted.length === 0) {
    return null
  }

  const labelParts = [
    ...isShortened ? [TEXT_SHORTENED_LABEL] : [],
    ...omitted.length > 0 ? [`${omitted.join(' \u00B7 ')} not sent`] : [],
  ]

  return {
    label: labelParts.join(' \u00B7 '),
    description: isShortened
      ? `${TEXT_ONLY_DESCRIPTION} ${TEXT_SHORTENED_DESCRIPTION}`
      : TEXT_ONLY_DESCRIPTION,
  }
}

/**
 * The note on an attached file. A file the send would refuse gets a blocking
 * note with the reason instead of being dropped, and "Needs Run code" when
 * only the sandbox could take it. An Office file whose text reaches the
 * model gets a quiet note only when that text leaves content out (see
 * `getTextLossNote`). Plain text files and complete Office files need none.
 */
export function getFileDeliveryHint(
  file: DeliveryFile,
  resolve: FileDeliveryResolver,
  resolveWithRunCode?: FileDeliveryResolver,
): FileDeliveryHint | null {
  const result = resolve(file)

  if (result.delivery === 'unsupported') {
    if (needsRunCode(file, resolveWithRunCode)) {
      return {
        label: NEEDS_RUN_CODE_LABEL,
        description: NEEDS_RUN_CODE_DESCRIPTION,
        isBlocking: true,
      }
    }

    const { why, fix } = describeFileDeliveryReason(result.reason)

    return {
      label: getRejectionCaption(result.reason),
      description: `${why} ${fix.replace(/\.$/, '')}.`,
      isBlocking: true,
    }
  }

  if (!isOfficeMediaType(file.type) || result.delivery !== 'text') {
    return null
  }

  const note = getTextLossNote(file)

  return note ? { ...note, isBlocking: false } : null
}

/**
 * What stops a send when attached files cannot be delivered, one message per
 * reason. Files that only Run code could take are named together.
 */
export function getBlockedFileMessages(
  files: (DeliveryFile & { name: string })[],
  resolve: FileDeliveryResolver,
  resolveWithRunCode: FileDeliveryResolver | undefined,
  canAttachMediaType: (mediaType: string) => boolean,
): string[] {
  const runCodeNames: string[] = []
  const rejections: FileRejection[] = []

  for (const file of files) {
    const rejection = getFileRejection(file, resolve)

    if (!rejection) {
      continue
    }

    if (needsRunCode(file, resolveWithRunCode)) {
      runCodeNames.push(file.name)
    } else {
      rejections.push(rejection)
    }
  }

  const messages = getRejectionMessages(rejections, canAttachMediaType)

  if (runCodeNames.length > 0) {
    const isPlural = runCodeNames.length > 1

    messages.push(
      `${runCodeNames.slice(0, 3).join(', ')}: Turn on Run code to send `
      + `${isPlural ? 'these files' : 'this file'}, or remove `
      + `${isPlural ? 'them' : 'it'}.`,
    )
  }

  return messages
}

export function getFileRejection(
  file: DeliveryFile,
  resolve: FileDeliveryResolver,
): FileRejection | null {
  const { delivery, reason } = resolve(file)

  if (delivery !== 'unsupported') {
    return null
  }

  return { reason, type: file.type, name: file.name }
}

const REJECTION_CAPTIONS: Record<FileDeliveryReason, string> = {
  'model-no-image': 'Model can\'t read images',
  'model-no-pdf': 'Model can\'t read PDFs',
  'office-unreadable': 'No readable text',
  'legacy-office': 'Old Office format',
  'unsupported-type': 'Type not supported',
}

/**
 * The few words shown on a file the selected model cannot take, so the
 * reason is visible without hovering; the full sentence stays in the tooltip.
 */
export function getRejectionCaption(
  reason: FileDeliveryReason | undefined,
): string {
  return REJECTION_CAPTIONS[reason ?? 'unsupported-type']
}

export function isModelCapabilityRejection(
  rejection: FileRejection,
): boolean {
  return isMediaCapabilityReason(rejection.reason)
}

function isMediaCapabilityReason(
  reason: FileDeliveryReason | undefined,
): boolean {
  return reason === 'model-no-image' || reason === 'model-no-pdf'
}

/**
 * One warning per reason, so a mixed drop (an image and a legacy .xls on a
 * text-only model) explains each file instead of collapsing to one generic
 * line. Image and PDF reasons keep the model-switch wording.
 */
export function getRejectionMessages(
  rejections: FileRejection[],
  canAttachMediaType: (mediaType: string) => boolean,
): string[] {
  const mediaRejections = rejections.filter((rejection) => {
    return isMediaCapabilityReason(rejection.reason)
  })
  const otherReasons = new Set<FileDeliveryReason | undefined>(
    rejections
      .filter(rejection => !isMediaCapabilityReason(rejection.reason))
      .map(rejection => rejection.reason),
  )
  const messages: string[] = []

  if (mediaRejections.length > 0) {
    messages.push(
      getUnsupportedInputMessage(
        mediaRejections.map(rejection => rejection.type),
        canAttachMediaType,
      ),
    )
  }

  for (const reason of otherReasons) {
    const reasonRejections = rejections.filter((rejection) => {
      return rejection.reason === reason
    })

    messages.push(describeRejectedFiles(reason, reasonRejections))
  }

  return messages
}

function describeRejectedFiles(
  reason: FileDeliveryReason | undefined,
  rejections: FileRejection[],
): string {
  const { why, fix } = describeFileDeliveryReason(reason)
  const names = rejections
    .map(rejection => rejection.name)
    .filter((name): name is string => !!name)
  const prefix = names.length > 0 ? `${names.slice(0, 3).join(', ')}: ` : ''

  return `${prefix}${why} ${fix.replace(/\.$/, '')}.`
}
