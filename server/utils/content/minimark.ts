export type MinimarkNode
  = string
    | [string, Record<string, unknown>, ...MinimarkNode[]]

export interface MinimarkBody {
  type: string
  value: MinimarkNode[]
}

export type ComponentRenderers = Record<
  string,
  (props: Record<string, unknown>) => string
>

export interface MinimarkRenderOptions {
  components?: ComponentRenderers
}

const HEADING_LEVELS: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
}

const INLINE_TAGS = new Set([
  'a',
  'strong',
  'b',
  'em',
  'i',
  'code',
  'del',
  's',
  'mark',
  'sub',
  'sup',
  'span',
  'kbd',
  'u',
  'br',
  'img',
])

const LIST_TAGS = new Set(['ol', 'ul'])

const TEXT_CONTAINER_TAGS = new Set([
  ...INLINE_TAGS,
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'td',
  'th',
])

function isElement(
  node: MinimarkNode,
): node is [string, Record<string, unknown>, ...MinimarkNode[]] {
  return Array.isArray(node)
}

function isInlineNode(
  node: MinimarkNode,
  options: MinimarkRenderOptions,
): boolean {
  if (!isElement(node)) {
    return true
  }

  const [tag] = node

  return INLINE_TAGS.has(tag) || !!options.components?.[tag]
}

function renderInlineNodes(
  nodes: MinimarkNode[],
  options: MinimarkRenderOptions,
): string {
  return nodes.map((node) => {
    return renderInlineNode(node, options)
  }).join('')
}

function renderInlineNode(
  node: MinimarkNode,
  options: MinimarkRenderOptions,
): string {
  if (!isElement(node)) {
    return node
  }

  const [tag, props, ...children] = node
  const componentRenderer = options.components?.[tag]

  if (componentRenderer) {
    return componentRenderer(props)
  }

  const content = renderInlineNodes(children, options)

  switch (tag) {
    case 'strong':
    case 'b':
      return `**${content}**`
    case 'em':
    case 'i':
      return `*${content}*`
    case 'code':
      return `\`${content}\``
    case 'del':
    case 's':
      return `~~${content}~~`
    case 'a':
      return `[${content}](${String(props.href ?? '')})`
    case 'img':
      return `![${String(props.alt ?? '')}](${String(props.src ?? '')})`
    case 'br':
      return '\n'
    default:
      return content
  }
}

function renderList(
  tag: string,
  items: MinimarkNode[],
  options: MinimarkRenderOptions,
): string {
  return items
    .filter(isElement)
    .map((item, index) => {
      const marker = tag === 'ol' ? `${index + 1}.` : '-'
      const [, , ...children] = item
      const body = renderBlocks(children, options)

      const indentedBody = body
        .split('\n')
        .map((line, lineIndex) => {
          return lineIndex === 0 || line === '' ? line : `   ${line}`
        })
        .join('\n')

      return `${marker} ${indentedBody}`
    })
    .join('\n')
}

function collectTableRows(
  nodes: MinimarkNode[],
): [string, Record<string, unknown>, ...MinimarkNode[]][] {
  return nodes.filter(isElement).flatMap((node) => {
    const [tag, , ...children] = node

    return tag === 'tr' ? [node] : collectTableRows(children)
  })
}

function renderTable(
  children: MinimarkNode[],
  options: MinimarkRenderOptions,
): string {
  const rows = collectTableRows(children).map((row) => {
    const [, , ...cells] = row

    return cells
      .filter(isElement)
      .map((cell) => {
        const [, , ...cellChildren] = cell

        return renderInlineNodes(cellChildren, options)
          .replace(/\|/g, '\\|')
          .replace(/\n/g, ' ')
          .trim()
      })
  })
  const [headerRow, ...bodyRows] = rows

  if (!headerRow) {
    return ''
  }

  return [
    headerRow,
    headerRow.map(() => {
      return '---'
    }),
    ...bodyRows,
  ].map((cells) => {
    return `| ${cells.join(' | ')} |`
  }).join('\n')
}

function renderCodeBlock(children: MinimarkNode[]): string {
  const codeNode = children.find(isElement)
  const language = codeNode ? String(codeNode[1].language ?? '') : ''
  const source = codeNode
    ? codeNode.slice(2).map((child) => {
      return typeof child === 'string' ? child : ''
    }).join('')
    : ''

  return `\`\`\`${language}\n${source.replace(/\n$/, '')}\n\`\`\``
}

function renderBlockNode(
  node: [string, Record<string, unknown>, ...MinimarkNode[]],
  options: MinimarkRenderOptions,
): string {
  const [tag, , ...children] = node
  const headingLevel = HEADING_LEVELS[tag]

  if (headingLevel) {
    return `${'#'.repeat(headingLevel)} ${renderInlineNodes(children, options)}`
  }

  if (LIST_TAGS.has(tag)) {
    return renderList(tag, children, options)
  }

  switch (tag) {
    case 'p':
      return renderInlineNodes(children, options)
    case 'pre':
      return renderCodeBlock(children)
    case 'table':
      return renderTable(children, options)
    case 'hr':
      return '---'
    case 'blockquote':
      return renderBlocks(children, options)
        .split('\n')
        .map((line) => {
          return `> ${line}`
        })
        .join('\n')
    default:
      return renderBlocks(children, options)
  }
}

function renderBlocks(
  nodes: MinimarkNode[],
  options: MinimarkRenderOptions,
): string {
  const blocks: string[] = []
  let inlineRun: MinimarkNode[] = []

  function flushInlineRun() {
    const text = renderInlineNodes(inlineRun, options).trim()

    if (text) {
      blocks.push(text)
    }

    inlineRun = []
  }

  for (const node of nodes) {
    if (isInlineNode(node, options)) {
      inlineRun.push(node)

      continue
    }

    flushInlineRun()

    if (isElement(node)) {
      const block = renderBlockNode(node, options)

      if (block.trim()) {
        blocks.push(block)
      }
    }
  }

  flushInlineRun()

  return blocks.join('\n\n')
}

/**
 * Nuxt Content stores a page body as a minimark tree, not as the source
 * markdown. This renders the structures the public pages use (headings, lists,
 * links, emphasis, code) back to markdown; unknown containers keep their
 * children, and registered MDC components render through `options.components`.
 */
export function minimarkToMarkdown(
  body: MinimarkBody | null | undefined,
  options: MinimarkRenderOptions = {},
): string {
  if (!body || !Array.isArray(body.value)) {
    return ''
  }

  return renderBlocks(body.value, options)
}

function replaceComponentNode(
  node: MinimarkNode,
  components: ComponentRenderers,
  parentTag?: string,
): MinimarkNode {
  if (!isElement(node)) {
    return node
  }

  const [tag, props, ...children] = node
  const componentRenderer = components[tag]

  if (componentRenderer) {
    const text = componentRenderer(props)

    return parentTag && TEXT_CONTAINER_TAGS.has(parentTag)
      ? text
      : ['p', {}, text]
  }

  return [
    tag,
    props,
    ...children.map((child) => {
      return replaceComponentNode(child, components, tag)
    }),
  ]
}

/**
 * Replaces registered MDC component nodes with the text their renderer
 * returns, so a serializer that knows nothing about the components (the
 * markdown twins) emits real text instead of `:name{}` directives. A
 * component inside a text container becomes inline text; anywhere else it
 * becomes its own paragraph. Returns a new tree and leaves the input alone.
 */
export function replaceMinimarkComponents(
  nodes: MinimarkNode[],
  components: ComponentRenderers,
): MinimarkNode[] {
  return nodes.map((node) => {
    return replaceComponentNode(node, components)
  })
}
