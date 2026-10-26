import TurndownService from 'turndown'
import {
  strikethrough,
  tables,
  taskListItems,
} from '@joplin/turndown-plugin-gfm'

const MAX_IMAGE_ALT_CHARS = 120
const ALLOWED_LINK_SCHEMES: ReadonlySet<string> = new Set([
  'http',
  'https',
  'mailto',
  'tel',
])
const LINK_SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i
const HIDDEN_URL_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}\s]/gu
const CONTROL_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]/gu
const MARKDOWN_CHARACTERS = /[\\`*_~#>|[\]()!<{}]/g

let turndownService: TurndownService | null = null

function isAllowedLinkTarget(href: string): boolean {
  const schemeMatch = LINK_SCHEME_PATTERN.exec(
    href.replace(HIDDEN_URL_CHARACTERS, ''),
  )

  if (!schemeMatch) {
    return true
  }

  return ALLOWED_LINK_SCHEMES.has(schemeMatch[1]!.toLowerCase())
}

function toSafeAltText(alt: string | null): string {
  return (alt ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(MARKDOWN_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_IMAGE_ALT_CHARS)
    .trim()
}

function toLinkMarkdown(content: string, element: HTMLElement): string {
  const href = element.getAttribute('href')?.trim() ?? ''

  if (!isAllowedLinkTarget(href)) {
    return content
  }

  const target = href.replace(/\s/g, '%20').replace(/([()])/g, '\\$1')

  return `[${content}](${target})`
}

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
      return toSafeAltText((node as HTMLElement).getAttribute('alt'))
    },
  })
  service.addRule('knowledgeSafeLink', {
    filter: (node) => {
      return node.nodeName === 'A' && node.getAttribute('href') !== null
    },
    replacement: (content, node) => {
      return toLinkMarkdown(content, node as HTMLElement)
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
