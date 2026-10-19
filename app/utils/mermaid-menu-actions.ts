import type { DiagramMenuAction } from '~/types/diagram-export.d'

export const MERMAID_DOWNLOAD_ACTIONS: DiagramMenuAction[] = [
  {
    action: 'download-svg',
    label: 'SVG',
    icon: 'lucide:file-code',
    needsSvg: true,
  },
  {
    action: 'download-png',
    label: 'PNG',
    icon: 'lucide:image',
    needsSvg: true,
  },
  {
    action: 'download-drawio',
    label: '.drawio',
    icon: 'lucide:workflow',
    needsSvg: true,
  },
]

export const MERMAID_COPY_ACTIONS: DiagramMenuAction[] = [
  {
    action: 'copy-source',
    label: 'Code',
    icon: 'lucide:code',
    needsSvg: false,
  },
  {
    action: 'copy-markdown',
    label: 'Markdown',
    icon: 'lucide:file-text',
    needsSvg: false,
  },
  {
    action: 'copy-svg',
    label: 'SVG',
    icon: 'lucide:file-code',
    needsSvg: true,
  },
  {
    action: 'copy-drawio',
    label: 'For draw.io',
    icon: 'lucide:workflow',
    needsSvg: true,
  },
]
