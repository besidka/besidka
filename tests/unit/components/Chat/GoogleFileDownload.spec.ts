import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatGoogleFileDownload from '../../../../app/components/Chat/GoogleFileDownload.vue'

enableAutoUnmount(afterEach)

const CHAT_SLUG = '01JABCDEFGHJKMNPQRSTVWXYZ0'
const FILE_ID = 'abcdefghij1234567890'

async function mountMenu(props: Record<string, unknown> = {}) {
  return await mountSuspended(ChatGoogleFileDownload, {
    attachTo: document.body,
    props: {
      kind: 'document',
      title: 'Quarterly plan',
      fileId: FILE_ID,
      chatSlug: CHAT_SLUG,
      ...props,
    } as never,
  })
}

function clickAnchor(element: Element): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })

  element.addEventListener('click', (clicked) => {
    clicked.preventDefault()
  }, { once: true, capture: false })
  element.dispatchEvent(event)

  return event
}

describe('Chat/GoogleFileDownload', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['document', ['docx', 'txt'], [
      'Download as Word (.docx)',
      'Download as text (.txt)',
    ]],
    ['spreadsheet', ['xlsx', 'csv'], [
      'Download as Excel (.xlsx)',
      'Download first sheet as CSV',
    ]],
    ['text', ['txt'], ['Download as text']],
  ])('lists the formats of a %s', async (kind, formats, labels) => {
    const wrapper = await mountMenu({ kind })
    const items = wrapper.findAll('[data-testid^="google-file-download-"]')
      .filter(item => item.element.tagName === 'A')

    expect(items.map(item => item.text())).toEqual(labels)
    expect(items.map((item) => {
      return item.attributes('data-testid')?.replace('google-file-download-', '')
    })).toEqual(formats)
  })

  it('links each item to the route with the chat, file and format only',
    async () => {
      const wrapper = await mountMenu()
      const link = wrapper.get('[data-testid="google-file-download-docx"]')
      const url = new URL(link.attributes('href')!, 'https://besidka.com')

      expect(link.attributes('download')).toBeDefined()
      expect(url.pathname)
        .toBe('/api/v1/google/drive/created-files/download')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        chatSlug: CHAT_SLUG,
        fileId: FILE_ID,
        format: 'docx',
      })
    })

  it('keeps the visible word Download for a screen reader below sm',
    async () => {
      const wrapper = await mountMenu()
      const trigger = wrapper.get('[data-testid="google-file-download-trigger"]')

      expect(trigger.text()).toBe('Download')
      expect(trigger.findAll('span').at(-1)!.classes())
        .toContain('max-sm:sr-only')
      expect(trigger.classes()).toContain('max-sm:btn-square')
      expect(trigger.get('[aria-hidden="true"]').exists()).toBe(true)
    })

  it.each([
    ['no chat slug', { chatSlug: '' }],
    ['no file id', { fileId: undefined }],
  ])('renders nothing with %s', async (_name, props) => {
    const wrapper = await mountMenu(props)

    expect(wrapper.find('[data-testid="google-file-download"]').exists())
      .toBe(false)
  })

  it('does not put the title or other props in the page', async () => {
    const wrapper = await mountMenu({ content: 'secret body text' })

    expect(wrapper.html()).not.toContain('secret body text')
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const wrapper = await mountMenu()
    const details = wrapper.get('details').element as HTMLDetailsElement

    details.open = true
    await wrapper.get('details').trigger('keydown', { key: 'Escape' })

    expect(details.open).toBe(false)
  })

  it('closes after an item is chosen and ignores a second click within a '
    + 'moment', async () => {
    vi.useFakeTimers()

    const wrapper = await mountMenu()
    const details = wrapper.get('details').element as HTMLDetailsElement
    const link = wrapper.get('[data-testid="google-file-download-docx"]')

    details.open = true
    clickAnchor(link.element)

    expect(details.open).toBe(false)

    await wrapper.vm.$nextTick()

    expect(link.attributes('aria-disabled')).toBe('true')

    const second = new MouseEvent('click', { bubbles: true, cancelable: true })

    link.element.dispatchEvent(second)

    expect(second.defaultPrevented).toBe(true)

    vi.advanceTimersByTime(1600)
    await wrapper.vm.$nextTick()

    expect(link.attributes('aria-disabled')).toBeUndefined()
  })
})
