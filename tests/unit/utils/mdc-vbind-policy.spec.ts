import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import sanitizeHtml from 'sanitize-html'
import { describe, expect, it } from 'vitest'

interface CompiledNode {
  type: string
  tag?: string
  props?: Record<string, unknown>
  children?: CompiledNode[]
}

function collectElements(node: CompiledNode): CompiledNode[] {
  const children = node.children ?? []

  return [
    ...(node.type === 'element' ? [node] : []),
    ...children.flatMap(collectElements),
  ]
}

async function compilePropKeys(markdown: string): Promise<string[]> {
  const parsed = await parseMarkdown(markdown, { highlight: false })

  return collectElements(parsed.body as CompiledNode)
    .flatMap(element => Object.keys(element.props ?? {}))
}

function isForbiddenKey(key: string, tag?: string): boolean {
  if (tag === 'template' && /^v-slot(:|$)/i.test(key)) {
    return false
  }

  return /^(v-|:|@)/i.test(key) || /^(inner|outer)html$/i.test(key)
}

function hasDirectiveKey(propKeys: string[]): boolean {
  return propKeys.some(isForbiddenKey)
}

function collectForbiddenKeys(node: CompiledNode): string[] {
  const ownKeys = Object.keys(node.props ?? {})
    .filter(key => isForbiddenKey(key, node.tag))
  const childKeys = (node.children ?? []).flatMap(collectForbiddenKeys)

  return [...ownKeys, ...childKeys]
}

function sanitizeLikeUserMessage(markdown: string): string {
  return sanitizeHtml(markdown, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'recursiveEscape',
  })
}

const TEMPLATE_BYPASS_PAYLOADS: Record<string, string> = {
  'raw html template': [
    '<template><span v-bind=\'{"innerHTML":"X"}\'>x</span></template>',
  ].join('\n'),
  'raw html template nested in an element': [
    '<div><template><b v-model:innerHTML="y"></b></template></div>',
  ].join('\n'),
  'mdc template block': [
    '::template',
    '[x]{v-bind=\'{"innerHTML":"X"}\'}',
    '::',
  ].join('\n'),
}

describe('mdc directive prop policy', () => {
  it('drops a bare v-bind attribute from raw html', async () => {
    const propKeys = await compilePropKeys(
      '<span v-bind=\'{"title":"marker"}\'>x</span>',
    )

    expect(propKeys).not.toContain('v-bind')
    expect(hasDirectiveKey(propKeys)).toBe(false)
  })

  it('drops a bare v-bind attribute from the mdc inline form', async () => {
    const propKeys = await compilePropKeys(
      '[x]{v-bind=\'{"title":"marker"}\'}',
    )

    expect(propKeys).not.toContain('v-bind')
    expect(hasDirectiveKey(propKeys)).toBe(false)
  })

  it('drops v-bind keys whose json carries innerHTML', async () => {
    const propKeys = await compilePropKeys(
      '[x]{v-bind=\'{"innerHTML":"<b>marker</b>"}\'}',
    )

    expect(hasDirectiveKey(propKeys)).toBe(false)
  })

  it('drops other vue directive style attributes', async () => {
    const markdown = [
      '[a]{v-model:innerHTML=\'<b>marker</b>\'}',
      '',
      '[b]{v-html=\'marker\'}',
      '',
      '[c]{@click=\'marker\'}',
      '',
      '[d]{:title=\'marker\'}',
    ].join('\n')
    const propKeys = await compilePropKeys(markdown)

    expect(hasDirectiveKey(propKeys)).toBe(false)
  })

  it('keeps ordinary markdown output intact', async () => {
    const markdown = [
      '# Heading',
      '',
      '[link](https://example.com/page "Title")',
      '',
      '`inline` and **bold**',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '```mermaid',
      'graph TD; A-->B',
      '```',
      '',
      '```ts',
      'const value = 1',
      '```',
    ].join('\n')
    const parsed = await parseMarkdown(markdown, { highlight: false })
    const elements = collectElements(parsed.body as CompiledNode)
    const tags = elements.map(element => element.tag)
    const link = elements.find(element => element.tag === 'a')

    expect(tags).toEqual(expect.arrayContaining([
      'h1',
      'a',
      'code',
      'strong',
      'table',
      'th',
      'td',
      'pre',
    ]))
    expect(link?.props?.href).toBe('https://example.com/page')
    expect(link?.props?.title).toBe('Title')

    const mermaid = elements.find((element) => {
      return element.tag === 'pre'
        && (element.props?.language === 'mermaid'
          || element.props?.className?.toString().includes('mermaid'))
    })

    expect(mermaid).toBeDefined()
  })

  it('keeps plain safe attributes on raw html', async () => {
    const parsed = await parseMarkdown(
      '<span title="kept" class="note">x</span>',
      { highlight: false },
    )
    const span = collectElements(parsed.body as CompiledNode)
      .find(element => element.tag === 'span')

    expect(span?.props?.title).toBe('kept')
  })

  describe('template content bypass', () => {
    for (const [label, payload] of Object.entries(TEMPLATE_BYPASS_PAYLOADS)) {
      it(`drops directive keys inside a ${label}`, async () => {
        const parsed = await parseMarkdown(payload, { highlight: false })

        expect(collectForbiddenKeys(parsed.body as CompiledNode)).toEqual([])
      })

      it(`drops directive keys inside a ${label} after user sanitizing`,
        async () => {
          const parsed = await parseMarkdown(
            sanitizeLikeUserMessage(payload),
            { highlight: false },
          )

          expect(collectForbiddenKeys(parsed.body as CompiledNode))
            .toEqual([])
        })
    }
  })

  it('keeps named mdc slots working through the title slot', async () => {
    const parsed = await parseMarkdown(
      '::card\n#title\nhi\n::',
      { highlight: false },
    )
    const card = collectElements(parsed.body as CompiledNode)
      .find(element => element.tag === 'card')
    const slotTemplate = card?.children?.find((child) => {
      return child.tag === 'template'
    })

    expect(slotTemplate?.props).toHaveProperty('v-slot:title')
    expect(collectForbiddenKeys(parsed.body as CompiledNode)).toEqual([])
  })

  it('still strips v-bind from a template element', async () => {
    const parsed = await parseMarkdown(
      '<template v-bind=\'{"innerHTML":"X"}\' v-slot:title v-on:click="m">'
      + '<b>x</b></template>',
      { highlight: false },
    )
    const template = collectElements(parsed.body as CompiledNode)
      .find(element => element.tag === 'template')

    expect(template?.props).not.toHaveProperty('v-bind')
    expect(template?.props).not.toHaveProperty('v-on:click')
    expect(collectForbiddenKeys(parsed.body as CompiledNode)).toEqual([])
  })

  it('tripwire: no compiled node anywhere carries a forbidden key', async () => {
    const markdown = [
      '<template><span v-bind=\'{"innerHTML":"X"}\'>x</span></template>',
      '',
      '<div><template><b v-model:innerHTML="y"></b></template></div>',
      '',
      '::template',
      '[x]{v-bind=\'{"innerHTML":"X"}\'}',
      '::',
      '',
      '[a]{v-bind=\'{"title":"m"}\' :title=\'m\' @click=\'m\' innerHTML=\'m\'}',
      '',
      '<p outerHTML="m" v-html="m">y</p>',
    ].join('\n')
    const parsed = await parseMarkdown(markdown, { highlight: false })

    expect(collectForbiddenKeys(parsed.body as CompiledNode)).toEqual([])
  })
})
