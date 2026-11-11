import type { Cell } from '@besidka/doc-renderer/spec'
import type {
  DocumentFormat,
  DocumentStats,
} from '#shared/utils/documents'
import { formatFileSize } from '#shared/utils/files'
import { toSafeLocalUrl } from '~/utils/chat-context'

export interface SharedDocumentFile {
  url: string
  name: string
  size: number
  type: string
}

export const DOCUMENT_FORMAT_ICONS: Record<DocumentFormat, string> = {
  docx: 'lucide:file-text',
  pptx: 'lucide:presentation',
  xlsx: 'lucide:sheet',
  pdf: 'lucide:file-type',
}

function formatCount(count: number, singular: string): string {
  return `${count.toLocaleString('en-US')} ${singular}${
    count === 1 ? '' : 's'
  }`
}

export function getDocumentStatsLabel(
  format: DocumentFormat,
  stats: DocumentStats | null | undefined,
): string {
  if (!stats) {
    return ''
  }

  if (format === 'pptx' && stats.slides !== null) {
    return formatCount(stats.slides, 'slide')
  }

  if (format === 'xlsx' && stats.sheets !== null) {
    return formatCount(stats.sheets, 'sheet')
  }

  if (stats.pages !== null && (format === 'pdf' || format === 'docx')) {
    return formatCount(stats.pages, 'page')
  }

  return ''
}

export function getDocumentMetaLabel(
  format: DocumentFormat,
  stats: DocumentStats | null | undefined,
  size: number | null | undefined,
): string {
  const parts = [getDocumentStatsLabel(format, stats)]

  if (typeof size === 'number' && size > 0) {
    parts.push(formatFileSize(size))
  }

  return parts.filter(Boolean).join(' · ')
}

export function getMessageModelId(message: {
  metadata?: unknown
}): string | undefined {
  const metadata = message.metadata

  if (typeof metadata !== 'object' || metadata === null) {
    return undefined
  }

  const usage = (metadata as { usage?: { model?: unknown } }).usage

  return typeof usage?.model === 'string' && usage.model
    ? usage.model
    : undefined
}

export function formatDocumentCell(cell: Cell | undefined): string {
  if (cell === null || cell === undefined) {
    return ''
  }

  if (typeof cell === 'string') {
    return cell
  }

  if (typeof cell === 'number' || typeof cell === 'boolean') {
    return String(cell)
  }

  if ('date' in cell) {
    return cell.date
  }

  if (cell.cached !== undefined) {
    return String(cell.cached)
  }

  return `=${cell.formula}`
}

export function readSharedDocumentFile(
  part: unknown,
): SharedDocumentFile | null {
  if (typeof part !== 'object' || part === null) {
    return null
  }

  const data = (part as { data?: unknown }).data

  if (typeof data !== 'object' || data === null) {
    return null
  }

  const file = (data as { file?: unknown }).file

  if (typeof file !== 'object' || file === null) {
    return null
  }

  const { url, name, size, type } = file as Record<string, unknown>
  const safeUrl = toSafeLocalUrl(typeof url === 'string' ? url : null)

  if (!safeUrl || typeof name !== 'string') {
    return null
  }

  return {
    url: safeUrl,
    name,
    size: typeof size === 'number' ? size : 0,
    type: typeof type === 'string' ? type : '',
  }
}
