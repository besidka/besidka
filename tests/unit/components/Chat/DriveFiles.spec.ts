import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import DriveFiles from '../../../../app/components/Chat/DriveFiles.vue'

const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz'
const LINK = `https://drive.google.com/open?id=${FILE_ID}`

function message(role: 'user' | 'assistant', parts: unknown[]) {
  return { role, parts } as unknown as Pick<UIMessage, 'role' | 'parts'>
}

function drivePart(overrides: Record<string, unknown> = {}) {
  return {
    type: 'data-drive-file',
    data: {
      driveFileId: FILE_ID,
      name: 'Plan',
      mimeType: 'text/markdown',
      link: LINK,
      ...overrides,
    },
  }
}

describe('Chat/DriveFiles', () => {
  it('shows the file with the Drive mark and an Open in Google Drive link',
    async () => {
      const wrapper = await mountSuspended(DriveFiles, {
        props: { message: message('user', [drivePart()]) },
      })
      const link = wrapper.get('[data-testid="message-drive-file-link"]')

      expect(wrapper.get('[data-testid="message-drive-file"]').text())
        .toContain('Plan')
      expect(link.attributes('href')).toBe(LINK)
      expect(link.text()).toBe('Open in Google Drive')
      expect(link.attributes('rel')).toBe('noopener noreferrer')
      expect(link.attributes('target')).toBe('_blank')
      expect(wrapper.get('[role="img"]').attributes('aria-label'))
        .toBe('Google Drive')
    })

  it('shows the name only, with no link, in a public share', async () => {
    const wrapper = await mountSuspended(DriveFiles, {
      props: {
        message: message('user', [drivePart({
          driveFileId: '',
          mimeType: '',
          link: '',
        })]),
      },
    })

    expect(wrapper.get('[data-testid="message-drive-file"]').text())
      .toContain('Plan')
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('never links to a host other than Drive', async () => {
    const wrapper = await mountSuspended(DriveFiles, {
      props: {
        message: message('user', [drivePart({
          link: 'https://evil.example/phish',
        })]),
      },
    })

    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('evil.example')
  })

  it('renders nothing for an assistant message or a message without one',
    async () => {
      const assistant = await mountSuspended(DriveFiles, {
        props: { message: message('assistant', [drivePart()]) },
      })
      const plain = await mountSuspended(DriveFiles, {
        props: { message: message('user', [{ type: 'text', text: 'Hi' }]) },
      })

      expect(assistant.find('[data-testid="message-drive-files"]').exists())
        .toBe(false)
      expect(plain.find('[data-testid="message-drive-files"]').exists())
        .toBe(false)
    })
})
