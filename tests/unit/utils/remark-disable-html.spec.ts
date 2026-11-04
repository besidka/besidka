import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import { describe, expect, it } from 'vitest'
import { useChatFormat } from '../../../app/composables/chat-format'
import { remarkDisableHtml } from '../../../app/utils/remark-disable-html'

interface CompiledNode {
  type: string
  tag?: string
  value?: string
  props?: Record<string, unknown>
  children?: CompiledNode[]
}

const FORBIDDEN_TAGS = ['iframe', 'form', 'input', 'style', 'meta', 'link']

const DIRECTIVE_PAYLOADS: Record<string, string> = {
  'iframe block': '::iframe{src="https://evil.example" '
    + 'style="position:fixed;inset:0"}\n::',
  'form block with input': '::form{action="https://evil.example"}\n'
    + ':input{name=password type=password}\n::',
  'inline style': ':style[body{display:none}]',
  'span with inline style': ':span{style="position:fixed;inset:0"}[x]',
  'span with utility classes': ':span{class="fixed inset-0 z-50"}[x]',
  'meta refresh': ':meta{http-equiv="refresh" '
    + 'content="0;url=https://evil.example"}',
  'stylesheet link': ':link{rel=stylesheet href="https://evil.example/a.css"}',
  'binding directive': ':binding{value="$doc.updateRuntimeData"}',
  'binding interpolation': '{{ $doc.updateRuntimeData }}',
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

describe('remarkDisableHtml', () => {
  it('creates the micromark extension list when it is missing', () => {
    const data: Record<string, unknown> = {}

    remarkDisableHtml.call({ data: () => data })

    expect(data.micromarkExtensions).toEqual([
      { disable: { null: ['htmlFlow', 'htmlText'] } },
    ])
  })

  it('appends to an existing micromark extension list', () => {
    const existing = { disable: { null: ['other'] } }
    const data = { micromarkExtensions: [existing] }

    remarkDisableHtml.call({ data: () => data })

    expect(data.micromarkExtensions).toHaveLength(2)
    expect(data.micromarkExtensions[0]).toBe(existing)
  })
})

describe('user message html as literal text', () => {
  it('keeps generics such as Vec<String> unchanged', async () => {
    const body = await parseUserMessage('Use Vec<String> and Option<T> here')

    expect(collectText(body)).toBe('Use Vec<String> and Option<T> here')
    expect(findByTag(body, 'vec')).toEqual([])
  })

  it('keeps an unknown component tag as literal text', async () => {
    const body = await parseUserMessage('Render <MyComponent> please')

    expect(collectText(body)).toBe('Render <MyComponent> please')
    expect(findByTag(body, 'my-component')).toEqual([])
    expect(findByTag(body, 'mycomponent')).toEqual([])
  })

  it('does not let a block level tag swallow the fence after it', async () => {
    const body = await parseUserMessage('<div>x</div>\n```js\ncode <b>\n```')

    expect(findByTag(body, 'div')).toEqual([])
    expect(findByTag(body, 'pre')).toHaveLength(1)
    expect(collectText(body)).toContain('<div>x</div>')
    expect(collectText(body)).toContain('code <b>')
  })

  it('keeps markdown after an unclosed script tag', async () => {
    const body = await parseUserMessage('<script>\nfoo\n\n**after**')
    const strong = findByTag(body, 'strong')

    expect(findByTag(body, 'script')).toEqual([])
    expect(strong).toHaveLength(1)
    expect(collectText(strong[0]!)).toBe('after')
    expect(collectText(body)).toContain('<script>')
  })

  it('keeps an image tag with an event handler as text', async () => {
    const body = await parseUserMessage('<img src=x onerror=alert(1)>')

    expect(findByTag(body, 'img')).toEqual([])
    expect(collectText(body)).toBe('<img src=x onerror=alert(1)>')
  })

  it('keeps angle bracket autolinks working', async () => {
    const body = await parseUserMessage('see <https://example.com> now')
    const anchors = findByTag(body, 'a')

    expect(anchors).toHaveLength(1)
    expect(anchors[0]?.props?.href).toBe('https://example.com')
  })

  it('still strips javascript links', async () => {
    const body = await parseUserMessage('[x](javascript:alert(1))')
    const anchors = findByTag(body, 'a')

    expect(anchors.every((anchor) => {
      return !String(anchor.props?.href ?? '').startsWith('javascript:')
    })).toBe(true)
  })

  it('still turns single newlines into line breaks', async () => {
    const body = await parseUserMessage('first\nsecond')

    expect(findByTag(body, 'br')).toHaveLength(1)
  })

  it('still renders gfm tables, task lists and strikethrough', async () => {
    const table = await parseUserMessage('| a | b |\n| - | - |\n| 1 | 2 |')
    const tasks = await parseUserMessage('- [x] done\n- [ ] todo')
    const strike = await parseUserMessage('~~gone~~')

    expect(findByTag(table, 'table')).toHaveLength(1)
    expect(findByTag(table, 'td')).toHaveLength(2)
    expect(findByTag(tasks, 'input')).toHaveLength(2)
    expect(findByTag(strike, 'del')).toHaveLength(1)
  })

  it('leaves colons, braces and paths in plain text unchanged', async () => {
    const body = await parseUserMessage('at 10:30 {a} C:\\dir')

    expect(collectText(body)).toBe('at 10:30 {a} C:\\dir')
  })

  it('keeps emoji shortcodes resolving like the default parser', async () => {
    const body = await parseUserMessage('ok :smile:')
    const assistantBody = await parseMarkdown('ok :smile:', {
      highlight: false,
    })

    expect(collectText(body)).toBe(
      collectText(assistantBody.body as CompiledNode),
    )
    expect(collectText(body)).toBe('ok 😄')
  })
})

describe('user message mdc directive payloads', () => {
  for (const [name, payload] of Object.entries(DIRECTIVE_PAYLOADS)) {
    it(`renders ${name} as literal text`, async () => {
      const body = await parseUserMessage(payload)
      const elements = flatten(body).filter(node => node.type === 'element')

      for (const tag of FORBIDDEN_TAGS) {
        expect(findByTag(body, tag)).toEqual([])
      }

      expect(findByTag(body, 'binding')).toEqual([])
      expect(elements.every((element) => {
        return !element.props?.style && !element.props?.class
      })).toBe(true)
      expect(collectText(body).length).toBeGreaterThan(0)
    })
  }
})

async function parseAssistantMessage(markdown: string): Promise<CompiledNode> {
  const parsed = await parseMarkdown(
    markdown,
    useChatFormat().getParserOptions('assistant'),
  )

  return parsed.body as CompiledNode
}

describe('assistant message without mdc', () => {
  it('keeps template braces as literal text', async () => {
    const body = await parseAssistantMessage('Use {{ message }} in the template')

    expect(findByTag(body, 'binding')).toEqual([])
    expect(collectText(body)).toBe('Use {{ message }} in the template')
  })

  for (const [name, payload] of Object.entries(DIRECTIVE_PAYLOADS)) {
    it(`renders ${name} without live elements`, async () => {
      const body = await parseAssistantMessage(payload)
      const elements = flatten(body).filter(node => node.type === 'element')

      for (const tag of FORBIDDEN_TAGS) {
        expect(findByTag(body, tag)).toEqual([])
      }

      expect(findByTag(body, 'binding')).toEqual([])
      expect(elements.every((element) => {
        return !element.props?.style && !element.props?.class
      })).toBe(true)
      expect(collectText(body).length).toBeGreaterThan(0)
    })
  }

  it('keeps raw html such as br and sup inside gfm tables', async () => {
    const body = await parseAssistantMessage(
      '| a | b |\n| - | - |\n| x<br>y | m<sup>2</sup> |',
    )

    expect(findByTag(body, 'table')).toHaveLength(1)
    expect(findByTag(body, 'br')).toHaveLength(1)
    expect(findByTag(body, 'sup')).toHaveLength(1)
  })

  it('keeps a mermaid fence as a pre with the mermaid language', async () => {
    const body = await parseAssistantMessage(
      '```mermaid\ngraph TD\n  A --> B\n```',
    )
    const pres = findByTag(body, 'pre')

    expect(pres).toHaveLength(1)
    expect(pres[0]?.props?.language).toBe('mermaid')
    expect(pres[0]?.props?.code).toBe('graph TD\n  A --> B\n')
  })
})
