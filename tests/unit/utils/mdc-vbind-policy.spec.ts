import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import sanitizeHtml from 'sanitize-html'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import HomeBubble from '../../../app/components/content/HomeBubble.vue'
import HomeCta from '../../../app/components/content/HomeCta.vue'
import MDCRenderer from '@nuxtjs/mdc/runtime/components/MDCRenderer.vue'

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

  const bindingName = key.replace(/^:?[.^]?/, '')

  return /^(v-|@|on)/i.test(bindingName)
    || /^(inner|outer)-?html$/i.test(bindingName)
    || /^(srcdoc|formaction)$/i.test(bindingName)
}

function readContentFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

function listContentFiles(directory: string): string[] {
  return readdirSync(resolve(process.cwd(), directory), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const entryPath = `${directory}/${entry.name}`

    if (entry.isDirectory()) {
      return listContentFiles(entryPath)
    }

    return entry.name.endsWith('.md') ? [entryPath] : []
  })
}

async function findElements(
  markdown: string,
  tag: string,
): Promise<CompiledNode[]> {
  const parsed = await parseMarkdown(markdown, { highlight: false })

  return collectElements(parsed.body as CompiledNode)
    .filter(element => element.tag === tag)
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

  it('drops colon-prefixed attributes that reach html or handlers', async () => {
    const markdown = [
      '[a]{:innerHTML=\'<b>marker</b>\'}',
      '',
      '[b]{:v-bind=\'{"innerHTML":"X"}\'}',
      '',
      '[c]{:onclick=\'marker\'}',
      '',
      '[d]{:v-model:innerHTML=\'marker\'}',
      '',
      '[e]{:.innerHTML=\'marker\'}',
      '',
      '[f]{:srcdoc=\'marker\'}',
    ].join('\n')
    const propKeys = await compilePropKeys(markdown)

    expect(propKeys.filter(key => /html|v-|^:?on|srcdoc/i.test(key)))
      .toEqual([])
    expect(hasDirectiveKey(propKeys)).toBe(false)
  })

  it('keeps plain colon-prefixed bindings from mdc props', async () => {
    const [component] = await findElements(
      '::demo-card{:count=\'3\' :items=\'["a","b"]\' :title=\'marker\'}\n::',
      'demo-card',
    )

    expect(component?.props).toHaveProperty(':count', '3')
    expect(component?.props).toHaveProperty(':items', '["a","b"]')
    expect(component?.props).toHaveProperty(':title', 'marker')
  })

  it('keeps yaml object props of the real home-cta blocks', async () => {
    const homeCtas = await findElements(
      readContentFile('content/index.md'),
      'home-cta',
    )

    expect(homeCtas.length).toBeGreaterThanOrEqual(2)

    for (const homeCta of homeCtas) {
      const primary = JSON.parse(String(homeCta.props?.[':primary']))
      const secondary = JSON.parse(String(homeCta.props?.[':secondary']))

      expect(primary.label).toBe('Start chatting')
      expect(primary.href).toBe('/signup')
      expect(primary.icon).toBe('lucide:arrow-right')
      expect(typeof secondary.label).toBe('string')
      expect(typeof secondary.href).toBe('string')
    }

    expect(JSON.parse(String(homeCtas[0]?.props?.[':secondary'])).href)
      .toBe('#how-it-works')
  })

  it('renders the real home-cta blocks without crashing', async () => {
    const parsed = await parseMarkdown(
      readContentFile('content/index.md'),
      { highlight: false },
    )
    const wrapper = await mountSuspended(MDCRenderer, {
      props: {
        body: parsed.body,
        data: parsed.data,
        components: {
          'home-bubble': HomeBubble,
          'home-cta': HomeCta,
        },
      },
      global: {
        stubs: {
          Logo: true,
          Icon: true,
          HomeCarousel: true,
          HomeVideo: true,
          HomeStats: true,
          HomeStars: true,
          HomeFaq: true,
          HomeComparison: true,
          HomeFeatures: true,
        },
      },
    })
    const primaryButtons = wrapper.findAll('a.btn-primary')
      .filter(button => button.text().includes('Start chatting'))

    expect(primaryButtons.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps yaml boolean props of the real home-bubble blocks', async () => {
    const homeBubbles = await findElements(
      readContentFile('content/index.md'),
      'home-bubble',
    )
    const headingBubble = homeBubbles.find((bubble) => {
      return bubble.props?.id === 'benefits'
    })

    expect(headingBubble?.props?.[':heading']).toBe('true')
  })

  it('parses every content file without forbidden keys', async () => {
    const contentFiles = listContentFiles('content')

    expect(contentFiles.length).toBeGreaterThan(10)

    for (const contentFile of contentFiles) {
      const parsed = await parseMarkdown(
        readContentFile(contentFile),
        { highlight: false },
      )

      expect(collectForbiddenKeys(parsed.body as CompiledNode)).toEqual([])
    }
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
      '',
      '[b]{:innerHTML=\'m\' :v-bind=\'m\' :onclick=\'m\' :v-model:x=\'m\'}',
    ].join('\n')
    const parsed = await parseMarkdown(markdown, { highlight: false })

    expect(collectForbiddenKeys(parsed.body as CompiledNode)).toEqual([])
  })
})
