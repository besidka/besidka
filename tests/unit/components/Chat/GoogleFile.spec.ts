import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ChatGoogleFile from '../../../../app/components/Chat/GoogleFile.vue'
import { useSidePanel } from '../../../../app/composables/side-panel'
import { useGoogleFilePreview } from '../../../../app/composables/google-file-preview'
import {
  GOOGLE_DOCS_ICON,
  GOOGLE_DRIVE_ICON,
  GOOGLE_SHEETS_ICON,
} from '../../../../shared/utils/google-brand-icons'
import { filterPublicParts } from '../../../../server/utils/chats/share-public-parts'

enableAutoUnmount(afterEach)

const FILE_ID = 'abcdefghij1234567890'

function createPart(
  kind: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    type: 'tool-google__drive_create_file',
    toolCallId: 'call_1',
    state: 'output-available',
    input: { name: 'Plan', kind, content: '# Plan\n\n- one' },
    output: {
      references: [{
        id: FILE_ID,
        kind: 'file',
        title: 'Plan',
        link: `https://drive.google.com/open?id=${FILE_ID}`,
      }],
      bodyRemoved: true,
    },
    ...overrides,
  }
}

async function mountCard(part: unknown) {
  return mountSuspended(ChatGoogleFile, { props: { part } })
}

describe('Chat/GoogleFile', () => {
  beforeEach(() => {
    useSidePanel().close()
  })

  it.each([
    ['document', GOOGLE_DOCS_ICON, 'Google Docs', 'Google Docs'],
    ['spreadsheet', GOOGLE_SHEETS_ICON, 'Google Sheets', 'Google Sheets'],
    ['text', GOOGLE_DRIVE_ICON, 'Text file', 'Google Drive'],
  ])('shows the logo next to the product name of a %s', async (
    kind,
    icon,
    typeLabel,
    productName,
  ) => {
    const wrapper = await mountCard(createPart(kind))
    const logo = wrapper.get('[data-testid="google-file-card-icon"]')

    expect(wrapper.get('[data-testid="google-file-card"]').attributes('data-kind'))
      .toBe(kind)
    expect(logo.attributes('aria-hidden')).toBe('true')
    expect(logo.classes()).toContain(`i-${icon}`)
    expect(wrapper.get('[data-testid="google-file-card-title"]').text())
      .toBe('Plan')
    expect(wrapper.get('[data-testid="google-file-card-type"]').text())
      .toBe(typeLabel)
    expect(wrapper.get('[data-testid="google-file-card-meta"]').text())
      .toBe('in your Google Drive')
    expect(wrapper.get('[data-testid="google-file-card-open"]').text())
      .toContain(`Open in ${productName}`)
  })

  it('links to the editor with a new tab and no opener', async () => {
    const document = await mountCard(createPart('document'))
    const sheet = await mountCard(createPart('spreadsheet'))
    const text = await mountCard(createPart('text'))
    const link = document.get('[data-testid="google-file-card-open"]')

    expect(link.attributes('href'))
      .toBe(`https://docs.google.com/document/d/${FILE_ID}/edit`)
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(sheet.get('[data-testid="google-file-card-open"]')
      .attributes('href'))
      .toBe(`https://docs.google.com/spreadsheets/d/${FILE_ID}/edit`)
    expect(text.get('[data-testid="google-file-card-open"]')
      .attributes('href'))
      .toBe(`https://drive.google.com/open?id=${FILE_ID}`)
  })

  it('does not take the link from the stored link string', async () => {
    const wrapper = await mountCard(createPart('document', {
      output: {
        references: [{
          id: FILE_ID,
          kind: 'file',
          title: 'Plan',
          link: 'https://evil.example/phish',
        }],
      },
    }))

    expect(wrapper.html()).not.toContain('evil.example')
  })

  it('gives the card and its controls accessible names', async () => {
    const wrapper = await mountCard(createPart('document'))

    expect(wrapper.get('[data-testid="google-file-card"]')
      .attributes('aria-label')).toBe('Google Doc Plan')
    expect(wrapper.get('[data-testid="google-file-card-preview"]')
      .attributes('aria-label')).toBe('Preview Plan')
    expect(wrapper.get('[data-testid="google-file-card-open"]').text())
      .toContain('(opens in a new tab)')
  })

  it('opens the preview in the side panel when the card is clicked',
    async () => {
      const wrapper = await mountCard(createPart('spreadsheet', {
        input: { name: 'Plan', kind: 'spreadsheet', content: 'a,b\n1,2\n' },
      }))
      const sidePanel = useSidePanel()
      const trigger = wrapper.get('[data-testid="google-file-card-preview"]')

      expect(trigger.attributes('aria-expanded')).toBe('false')

      await trigger.trigger('click')

      expect(sidePanel.viewKey.value).toBe('google-file:call_1')
      expect(sidePanel.title.value).toBe('Plan')
      expect(sidePanel.mode.value).toBe('detail')
      expect(sidePanel.currentView.value?.props).toEqual({
        toolCallId: 'call_1',
        title: 'Plan',
        kind: 'spreadsheet',
        content: 'a,b\n1,2\n',
        openLink: `https://docs.google.com/spreadsheets/d/${FILE_ID}/edit`,
      })
      expect(sidePanel.currentView.value?.headerActions).toBeDefined()
      expect(trigger.attributes('aria-expanded')).toBe('true')
    })

  it('registers its file for the context panel and unregisters it',
    async () => {
      const wrapper = await mountCard(createPart('document'))
      const preview = useGoogleFilePreview()

      expect(preview.pushRegistered('call_1')).toBe(true)

      useSidePanel().close()
      wrapper.unmount()

      expect(preview.pushRegistered('call_1')).toBe(false)
    })

  it.each([
    ['input-available', { state: 'input-available' }],
    ['approval-requested', { state: 'approval-requested' }],
    ['output-error', { state: 'output-error', errorText: 'x' }],
    ['no reference', { output: { references: [] } }],
    ['an invalid id', {
      output: { references: [{ id: '../x', kind: 'file', title: 'Plan' }] },
    }],
  ])('renders no card for %s', async (_label, overrides) => {
    const wrapper = await mountCard(createPart('document', overrides))

    expect(wrapper.find('[data-testid="google-file-card"]').exists()).toBe(false)
  })

  it('renders no card for another part', async () => {
    const wrapper = await mountCard({ type: 'text', text: 'hello' })

    expect(wrapper.find('[data-testid="google-file-card"]').exists()).toBe(false)
  })

  it('never renders for a message of a shared chat', async () => {
    const [publicMessage] = filterPublicParts([{
      parts: [
        { type: 'text', text: 'I made the file.' },
        createPart('document'),
      ],
    }] as never)

    expect(publicMessage?.parts).toEqual([
      { type: 'text', text: 'I made the file.' },
    ])

    for (const part of publicMessage?.parts ?? []) {
      const wrapper = await mountCard(part)

      expect(wrapper.find('[data-testid="google-file-card"]').exists())
        .toBe(false)
    }
  })

  it('takes every logo from the brand constants, not literal names',
    () => {
      const source = readFileSync(
        resolve('app/components/Chat/GoogleFile.vue'),
        'utf8',
      )
      const previewSource = readFileSync(
        resolve('app/components/Chat/GoogleFilePreview.vue'),
        'utf8',
      )

      for (const file of [source, previewSource]) {
        expect(file).not.toMatch(/(?:logos|thesvg-color):/)
        expect(file).toContain('GOOGLE_FILE_KIND_ICONS')
      }
    })
})
