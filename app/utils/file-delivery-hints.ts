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
  WORKBOOK_MAP_TEXT_VERSION,
  getOfficeFormatByMediaType,
  isOfficeMediaType,
} from '#shared/utils/office-files'
import type { WorkbookTextSummary } from '#shared/utils/office-files'
import { getUnsupportedInputMessage } from '~/utils/files'

export interface DeliveryFile {
  type: string
  name?: string
  textStatus?: string | null
  textBytes?: number | null
  textVersion?: number | null
  textTruncated?: boolean
  textOmittedMedia?: number | null
  textOmittedCharts?: number | null
  workbookSummary?: WorkbookTextSummary | null
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

export const SPREADSHEET_MAP_LABEL = 'Values and formulas'

export const SPREADSHEET_MAP_DESCRIPTION = 'The model gets a map of this '
  + 'workbook: values, formulas, number formats, dropdown and conditional '
  + 'formatting rules, merged cells and notes. Values are the ones last '
  + 'saved in the file. Colors, charts and images aren\'t sent.'

const SPREADSHEET_ROWS_READ = '1,000'

const VALUES_CUT_SHEETS_SHOWN = 2

const STRUCTURE_CUTS: readonly string[] = [
  'formulas',
  'formula_patterns',
  'validations',
  'conditional_rules',
  'number_formats',
  'merged_cells',
  'notes',
  'names',
  'structure',
  'limits',
  'cells',
  'part',
]

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

function omittedSentence(file: DeliveryFile): string | null {
  const omitted = [
    formatOmittedCount(file.textOmittedCharts, 'chart', 'charts'),
    formatOmittedCount(file.textOmittedMedia, 'image', 'images'),
  ].filter((part): part is string => part !== null)

  if (omitted.length === 0) {
    return null
  }

  const isOne = omitted.length === 1 && /^1 /.test(omitted[0] as string)

  return `${omitted.join(' and ')} ${isOne ? 'isn\'t' : 'aren\'t'} sent.`
}

function valuesCutSentence(summary: WorkbookTextSummary): string | null {
  const shown = summary.valuesCut.slice(0, VALUES_CUT_SHEETS_SHOWN)

  if (shown.length === 0) {
    return null
  }

  const parts = shown.map((cut) => {
    return `after row ${cut.afterRow} of ${cut.sheet}`
  })
  const rest = summary.valuesCut.length - shown.length
  const more = rest > 0
    ? `, and on ${rest} more ${rest === 1 ? 'sheet' : 'sheets'}`
    : ''

  return `It is long, so values ${parts.join(' and ')}${more} aren't sent.`
}

function cutSentences(summary: WorkbookTextSummary): string[] {
  const sentences: string[] = []

  if (summary.cut.includes('sheets')) {
    sentences.push(
      `Only the first ${summary.sheets} of ${summary.sheetsTotal} sheets `
      + 'are sent.',
    )
  }

  if (summary.cut.includes('rows')) {
    sentences.push(
      `Sheets are read up to row ${SPREADSHEET_ROWS_READ}.`,
    )
  }

  if (summary.cut.includes('columns')) {
    sentences.push('Columns after GR aren\'t read.')
  }

  const valuesCut = valuesCutSentence(summary)

  if (valuesCut) {
    sentences.push(valuesCut)
  }

  if (summary.cut.some(cut => STRUCTURE_CUTS.includes(cut))) {
    sentences.push(
      'Some formulas, rules or notes are left out because the workbook is '
      + 'large.',
    )
  }

  return sentences
}

function sentences(parts: Array<string | null>): string {
  return parts.filter((part): part is string => !!part).join(' ')
}

/**
 * The note for a spreadsheet read as a workbook map. It always shows, not
 * only when something is cut: what the model gets, how many sheets and what
 * was cut when the upload carried the extraction summary. The label stays
 * short for the chip; the description goes to the info note. A spreadsheet
 * stored before the map (or whose version is not known yet) keeps the
 * loss-only note of the other Office files, so no "Sent as text" label comes
 * back (owner decision of 2026-11-12).
 */
export function getSpreadsheetNote(
  file: DeliveryFile,
): Pick<FileDeliveryHint, 'label' | 'description'> | null {
  const summary = file.workbookSummary
  const hasMap = !!summary
    || (file.textVersion ?? 0) >= WORKBOOK_MAP_TEXT_VERSION
  const omitted = omittedSentence(file)

  if (!hasMap) {
    return getTextLossNote(file)
  }

  if (!summary) {
    return {
      label: SPREADSHEET_MAP_LABEL,
      description: sentences([SPREADSHEET_MAP_DESCRIPTION, omitted]),
    }
  }

  const sheets = `${summary.sheets} ${summary.sheets === 1 ? 'sheet' : 'sheets'}`
  const labelParts = [
    sheets,
    summary.formulas > 0 ? 'formulas' : null,
    summary.cut.length > 0 ? TEXT_SHORTENED_LABEL.toLowerCase() : null,
  ].filter((part): part is string => part !== null)

  return {
    label: labelParts.join(' · '),
    description: sentences([
      SPREADSHEET_MAP_DESCRIPTION,
      ...cutSentences(summary),
      omitted,
    ]),
  }
}

function isSpreadsheet(file: DeliveryFile): boolean {
  return getOfficeFormatByMediaType(file.type) === 'xlsx'
}

export interface FileDeliveryHintOptions {
  spreadsheetNote?: boolean
}

/**
 * The note on a file. A file the send would refuse gets a blocking note
 * with the reason instead of being dropped, and "Needs Run code" when only
 * the sandbox could take it. An Office file whose text reaches the model
 * gets a quiet note only when that text leaves content out (see
 * `getTextLossNote`). With `spreadsheetNote` (the attach chip), a
 * spreadsheet always gets a note that says what the model gets (see
 * `getSpreadsheetNote`). Plain text files and complete documents need none.
 */
export function getFileDeliveryHint(
  file: DeliveryFile,
  resolve: FileDeliveryResolver,
  resolveWithRunCode?: FileDeliveryResolver,
  options: FileDeliveryHintOptions = {},
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

  const note = options.spreadsheetNote && isSpreadsheet(file)
    ? getSpreadsheetNote(file)
    : getTextLossNote(file)

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
