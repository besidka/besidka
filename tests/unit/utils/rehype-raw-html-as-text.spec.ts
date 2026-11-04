import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import { describe, expect, it } from 'vitest'
import { useChatFormat } from '../../../app/composables/chat-format'
import { rehypeRawHtmlAsText } from '../../../app/utils/rehype-raw-html-as-text'

interface CompiledNode {
  type: string
  tag?: string
  value?: string
  props?: Record<string, unknown>
  children?: CompiledNode[]
}

async function parseUserMessage(markdown: string): Promise<CompiledNode> {
  const parsed = await parseMarkdown(
    markdown,
    useChatFormat().getParserOptions('user'),
  )

  return parsed.body as CompiledNode
}

function flatten(node: CompiledNode): CompiledNode[] {
  return [node, ...(node.children ?? []).flatMap(flatten)]
}

function findByTag(root: CompiledNode, tag: string): CompiledNode[] {
  return flatten(root).filter(node => node.tag === tag)
}

function collectText(node: CompiledNode): string {
  return flatten(node)
    .filter(child => child.type === 'text')
    .map(child => child.value ?? '')
    .join('')
}

describe('rehypeRawHtmlAsText', () => {
  it('replaces a raw node inside an element with a text node', () => {
    const tree = {
      type: 'root',
      children: [{
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [{ type: 'raw', value: '<b>x</b>' }],
      }],
    }

    rehypeRawHtmlAsText()(tree)

    expect(tree.children[0]?.children).toEqual([
      { type: 'text', value: '<b>x</b>' },
    ])
  })

  it('wraps a root level raw node in a paragraph', () => {
    const tree = {
      type: 'root',
      children: [{ type: 'raw', value: '<img src=x>' }],
    }

    rehypeRawHtmlAsText()(tree)

    expect(tree.children).toEqual([{
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [{ type: 'text', value: '<img src=x>' }],
    }])
  })
})

describe('user message markdown parsing', () => {
  it('keeps inline html as literal text', async () => {
    const body = await parseUserMessage('Hi <b>x</b> there')

    expect(findByTag(body, 'b')).toEqual([])
    expect(collectText(body)).toContain('<b>x</b>')
  })

  it('renders a block level html payload as a literal paragraph', async () => {
    const body = await parseUserMessage('<img src=x onerror=alert(1)>')

    expect(findByTag(body, 'img')).toEqual([])
    expect(findByTag(body, 'p')).toHaveLength(1)
    expect(collectText(body)).toBe('<img src=x onerror=alert(1)>')
  })

  it('keeps ampersands and angle brackets literal', async () => {
    const body = await parseUserMessage('fish & chips, a > b')

    expect(collectText(body)).toBe('fish & chips, a > b')
  })

  it('renders a leading greater-than as a blockquote', async () => {
    const body = await parseUserMessage('> quote')

    expect(findByTag(body, 'blockquote')).toHaveLength(1)
    expect(collectText(body)).toBe('quote')
  })

  it('keeps fenced code verbatim', async () => {
    const body = await parseUserMessage(
      '```ts\nconst a = b && c < d\nconst e = "<div>"\n```',
    )

    expect(findByTag(body, 'pre')).toHaveLength(1)
    expect(collectText(body)).toContain('const a = b && c < d')
    expect(collectText(body)).toContain('const e = "<div>"')
    expect(collectText(body)).not.toContain('&amp;')
    expect(collectText(body)).not.toContain('&lt;')
  })

  it('keeps inline code verbatim', async () => {
    const body = await parseUserMessage('use `<div>` here')
    const code = findByTag(body, 'code')

    expect(code).toHaveLength(1)
    expect(collectText(code[0]!)).toBe('<div>')
  })

  it('renders bold text', async () => {
    const body = await parseUserMessage('**Razem: 5458 zł**')
    const strong = findByTag(body, 'strong')

    expect(strong).toHaveLength(1)
    expect(collectText(strong[0]!)).toBe('Razem: 5458 zł')
  })

  it('renders lists', async () => {
    const body = await parseUserMessage('- one\n- two')

    expect(findByTag(body, 'ul')).toHaveLength(1)
    expect(findByTag(body, 'li')).toHaveLength(2)
  })
})
