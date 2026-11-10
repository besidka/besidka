import type { DiagramExportAction } from './messages.ts'

export type DiagramMenuIcon
  = | 'code'
    | 'file-text'
    | 'file-code'
    | 'workflow'
    | 'image'

export interface DiagramMenuItem {
  action: DiagramExportAction
  label: string
  icon: DiagramMenuIcon
  needsSvg: boolean
}

export const DIAGRAM_DOWNLOAD_MENU_ITEMS = [
  { action: 'download-svg', label: 'SVG', icon: 'file-code', needsSvg: true },
  { action: 'download-png', label: 'PNG', icon: 'image', needsSvg: true },
  {
    action: 'download-drawio',
    label: '.drawio',
    icon: 'workflow',
    needsSvg: true,
  },
] as const satisfies readonly DiagramMenuItem[]

export const DIAGRAM_COPY_MENU_ITEMS = [
  { action: 'copy-source', label: 'Code', icon: 'code', needsSvg: false },
  {
    action: 'copy-markdown',
    label: 'Markdown',
    icon: 'file-text',
    needsSvg: false,
  },
  { action: 'copy-svg', label: 'SVG', icon: 'file-code', needsSvg: true },
  { action: 'copy-png', label: 'PNG', icon: 'image', needsSvg: true },
  {
    action: 'copy-drawio',
    label: 'For draw.io',
    icon: 'workflow',
    needsSvg: true,
  },
] as const satisfies readonly DiagramMenuItem[]

export const IMAGE_COPY_ACTION = 'copy-png' satisfies DiagramExportAction

export function isImageClipboardSupported(): boolean {
  if (typeof ClipboardItem === 'undefined') {
    return false
  }

  if (typeof navigator === 'undefined') {
    return false
  }

  if (typeof navigator.clipboard?.write !== 'function') {
    return false
  }

  return ClipboardItem.supports?.('image/png') !== false
}
