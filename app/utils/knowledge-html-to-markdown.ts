import TurndownService from 'turndown'
import {
  strikethrough,
  tables,
  taskListItems,
} from '@joplin/turndown-plugin-gfm'

let turndownService: TurndownService | null = null

function toTableCellMarkdown(
  service: TurndownService,
  cell: HTMLTableCellElement,
): string {
  return service
    .turndown(cell.innerHTML)
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

function tableToMarkdown(
  service: TurndownService,
  table: HTMLTableElement,
): string {
  const rows = Array.from(table.rows).map((row) => {
    return Array.from(row.cells).map((cell) => {
      return toTableCellMarkdown(service, cell)
    })
  })
  const columnCount = Math.max(0, ...rows.map(row => row.length))

  if (columnCount === 0) {
    return ''
  }

  const lines = rows.map((row) => {
    const cells = Array.from({ length: columnCount }, (_cell, columnIndex) => {
      return row[columnIndex] ?? ''
    })

    return `| ${cells.join(' | ')} |`
  })
  const separator = `| ${Array.from({ length: columnCount }, () => '---')
    .join(' | ')} |`

  lines.splice(1, 0, separator)

  return `\n\n${lines.join('\n')}\n\n`
}

function createTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  })

  service.use([tables, strikethrough, taskListItems])
  service.addRule('knowledgeTableFirstRowHeader', {
    filter: 'table',
    replacement: (_content, node) => {
      return tableToMarkdown(service, node as HTMLTableElement)
    },
  })
  service.addRule('knowledgeImageAltText', {
    filter: 'img',
    replacement: (_content, node) => {
      return (node as HTMLElement).getAttribute('alt')?.trim() ?? ''
    },
  })

  return service
}

export function htmlToKnowledgeMarkdown(html: string): string {
  turndownService ??= createTurndownService()

  return turndownService
    .turndown(html)
    .replaceAll('\u0000', '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
