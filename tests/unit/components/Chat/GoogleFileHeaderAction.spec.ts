import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ChatGoogleFileHeaderAction from '../../../../app/components/Chat/GoogleFileHeaderAction.vue'

enableAutoUnmount(afterEach)

const OPEN_LINK = 'https://docs.google.com/document/d/abcdefghij1234567890/edit'

describe('Chat/GoogleFileHeaderAction', () => {
  it.each([
    ['document', 'Open in Google Docs'],
    ['spreadsheet', 'Open in Google Sheets'],
    ['text', 'Open in Google Drive'],
  ])('names the product in full for a %s', async (kind, label) => {
    const wrapper = await mountSuspended(ChatGoogleFileHeaderAction, {
      props: { kind, openLink: OPEN_LINK } as never,
    })
    const link = wrapper.get('[data-testid="google-file-open"]')

    expect(link.text()).toBe(label)
    expect(link.attributes('title')).toBe(label)
    expect(link.attributes('aria-label')).toBe(`${label} (opens in a new tab)`)
  })

  it('opens the link in a new tab without an opener', async () => {
    const wrapper = await mountSuspended(ChatGoogleFileHeaderAction, {
      props: { kind: 'document', openLink: OPEN_LINK } as never,
    })
    const link = wrapper.get('[data-testid="google-file-open"]')

    expect(link.attributes('href')).toBe(OPEN_LINK)
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })

  it('offers Download next to Open when the file and the chat are known',
    async () => {
      const wrapper = await mountSuspended(ChatGoogleFileHeaderAction, {
        props: {
          kind: 'spreadsheet',
          openLink: OPEN_LINK,
          title: 'Budget',
          fileId: 'abcdefghij1234567890',
          chatSlug: '01JABCDEFGHJKMNPQRSTVWXYZ0',
        } as never,
      })

      expect(wrapper.find('[data-testid="google-file-download"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="google-file-download-csv"]').text())
        .toBe('Download first sheet as CSV')
      expect(wrapper.find('[data-testid="google-file-open"]').exists())
        .toBe(true)
    })

  it('shows only Open without a chat to download from', async () => {
    const wrapper = await mountSuspended(ChatGoogleFileHeaderAction, {
      props: { kind: 'document', openLink: OPEN_LINK } as never,
    })

    expect(wrapper.find('[data-testid="google-file-download"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="google-file-open"]').exists())
      .toBe(true)
  })

  it('does not copy the other panel props onto the link', async () => {
    const wrapper = await mountSuspended(ChatGoogleFileHeaderAction, {
      props: {
        kind: 'document',
        openLink: OPEN_LINK,
        content: 'secret body text',
        toolCallId: 'call_1',
        title: 'Plan',
      } as never,
    })

    expect(wrapper.html()).not.toContain('secret body text')
  })
})
