import {
  DIAGRAM_COPY_MENU_ITEMS,
  DIAGRAM_DOWNLOAD_MENU_ITEMS,
} from '@besidka/artifacts-protocol/diagram-menus'
import type { DiagramMenuItem } from '@besidka/artifacts-protocol/diagram-menus'
import type {
  DiagramExportAction,
  DiagramMenuAction,
} from '~/types/diagram-export.d'

function toMenuActions(
  items: readonly DiagramMenuItem[],
): DiagramMenuAction[] {
  return items.map((item) => {
    return {
      action: item.action as DiagramExportAction,
      label: item.label,
      icon: `lucide:${item.icon}`,
      needsSvg: item.needsSvg,
    }
  })
}

export const MERMAID_DOWNLOAD_ACTIONS: DiagramMenuAction[]
  = toMenuActions(DIAGRAM_DOWNLOAD_MENU_ITEMS)

export const MERMAID_COPY_ACTIONS: DiagramMenuAction[]
  = toMenuActions(DIAGRAM_COPY_MENU_ITEMS)
