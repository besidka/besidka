import { defineComponent, h } from 'vue'
import type { PropType } from 'vue'
import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import type { MDCParseOptions } from '@nuxtjs/mdc'
import MDCRenderer from '@nuxtjs/mdc/runtime/components/MDCRenderer.vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ChatGoogleFilePreview from '../../../../app/components/Chat/GoogleFilePreview.vue'

enableAutoUnmount(afterEach)

const RealParserMDCCached = defineComponent({
  name: 'MDCCached',
  props: {
    value: { type: String, required: true },
    cacheKey: { type: String, default: '' },
    components: { type: Object, default: () => ({}) },
    parserOptions: {
      type: Object as PropType<MDCParseOptions>,
      default: () => ({}),
    },
  },
  async setup(props) {
    const parsed = await parseMarkdown(props.value, props.parserOptions)

    return () => h(MDCRenderer, {
      body: parsed.body,
      data: parsed.data,
      components: props.components,
    })
  },
})

async function mountPreview(props: {
  kind: 'document' | 'spreadsheet' | 'text'
  content: string
  title?: string
}) {
  return mountSuspended(ChatGoogleFilePreview, {
    props: {
      toolCallId: 'call_1',
      title: props.title ?? 'Plan',
      kind: props.kind,
      content: props.content,
    },
    global: { stubs: { MDCCached: RealParserMDCCached } },
  })
}

describe('Chat/GoogleFilePreview', () => {
  it('names the product next to its logo and shows the title', async () => {
    const wrapper = await mountPreview({ kind: 'document', content: 'x' })

    expect(wrapper.get('[data-testid="google-file-preview-product"]').text())
      .toBe('Google Docs')
    expect(wrapper.get('[data-testid="google-file-preview-icon"]')
      .attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('[data-testid="google-file-preview-title"]').text())
      .toBe('Plan')
  })

  it('says the content is as created and later edits are not shown',
    async () => {
      const wrapper = await mountPreview({ kind: 'text', content: 'x' })

      expect(wrapper.get('[data-testid="google-file-preview-note"]').text())
        .toBe('As created by Besidka. Later edits in Google are not shown here.')
    })

  it('renders a document as Markdown', async () => {
    const wrapper = await mountPreview({
      kind: 'document',
      content: '# Quarterly plan\n\n- first item\n- second item\n',
    })
    const content = wrapper.get('[data-testid="google-file-preview-content"]')

    expect(content.attributes('role')).toBe('region')
    expect(content.attributes('tabindex')).toBe('0')
    expect(content.attributes('aria-label')).toBe('File content')
    expect(content.find('h1').text()).toBe('Quarterly plan')
    expect(content.findAll('li').map(item => item.text())).toEqual([
      'first item',
      'second item',
    ])
  })

  it('does not let Markdown inject HTML into the page', async () => {
    const wrapper = await mountPreview({
      kind: 'document',
      content: [
        'Hello <script>window.__injected = true</script>',
        '',
        '<img src="x" onerror="window.__injected = true">',
        '',
        '<iframe src="https://evil.example"></iframe>',
      ].join('\n'),
    })
    const content = wrapper.get('[data-testid="google-file-preview-content"]')

    expect(content.find('script').exists()).toBe(false)
    expect(content.find('iframe').exists()).toBe(false)
    expect(content.find('img').exists()).toBe(false)
    expect(content.element.querySelector('[onerror]')).toBeNull()
    expect(content.text()).toContain('<script>window.__injected = true</script>')
    expect((window as unknown as { __injected?: boolean }).__injected)
      .toBeUndefined()
  })

  it('renders a spreadsheet as a table with a header row', async () => {
    const wrapper = await mountPreview({
      kind: 'spreadsheet',
      content: 'Name,Amount\nRent,1200\n"Coffee, beans",30\n',
    })
    const content = wrapper.get('[data-testid="google-file-preview-content"]')

    expect(content.attributes('aria-label')).toBe('File content')
    expect(content.attributes('tabindex')).toBe('0')
    expect(wrapper.findAll('th').map(cell => cell.text())).toEqual([
      'Name',
      'Amount',
    ])
    expect(wrapper.findAll('th').every(cell => cell.attributes('scope') === 'col'))
      .toBe(true)
    expect(wrapper.findAll('[data-testid="google-file-preview-row"]'))
      .toHaveLength(2)
    expect(wrapper.findAll('td').map(cell => cell.text())).toEqual([
      'Rent',
      '1200',
      'Coffee, beans',
      '30',
    ])
  })

  it('shows cell text as text, never as markup', async () => {
    const wrapper = await mountPreview({
      kind: 'spreadsheet',
      content: 'Name\n<b>bold</b>\n',
    })

    expect(wrapper.find('td b').exists()).toBe(false)
    expect(wrapper.get('td').text()).toBe('<b>bold</b>')
  })

  it('falls back to the plain text when a CSV cannot be read', async () => {
    const wrapper = await mountPreview({
      kind: 'spreadsheet',
      content: 'a,b\n1\n',
    })

    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.get('[data-testid="google-file-preview-text"]').text())
      .toContain('a,b')
  })

  it('shows a text file as wrapped plain text', async () => {
    const wrapper = await mountPreview({
      kind: 'text',
      content: 'line one\n<b>line</b> two',
    })
    const text = wrapper.get('[data-testid="google-file-preview-text"]')

    expect(text.element.tagName).toBe('PRE')
    expect(text.classes()).toContain('whitespace-pre-wrap')
    expect(text.text()).toBe('line one\n<b>line</b> two')
    expect(text.find('b').exists()).toBe(false)
    expect(wrapper.get('[data-testid="google-file-preview-content"]')
      .attributes('role')).toBe('region')
  })

  it('does not put the file text on a DOM attribute', async () => {
    const wrapper = await mountPreview({
      kind: 'text',
      content: 'secret body text',
    })

    expect(wrapper.attributes('content')).toBeUndefined()
    expect(wrapper.attributes('tool-call-id')).toBeUndefined()
  })
})
