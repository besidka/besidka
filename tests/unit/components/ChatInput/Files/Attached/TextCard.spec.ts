import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TextCard from '../../../../../../app/components/ChatInput/Files/Attached/TextCard.vue'

const mocks = vi.hoisted(() => ({
  fetchTextFileContent: vi.fn(),
}))

mockNuxtImport('fetchTextFileContent', () => mocks.fetchTextFileContent)

describe('ChatInput/Files/Attached/TextCard', () => {
  beforeEach(() => {
    mocks.fetchTextFileContent.mockReset()
    mocks.fetchTextFileContent.mockResolvedValue('fetched one\nfetched two\n')
  })

  it('shows the first lines and the line count of inline content', async () => {
    const wrapper = await mountSuspended(TextCard, {
      props: {
        file: { name: 'Pasted text', type: 'text/plain', size: 30 },
        content: 'one\n\ntwo\nthree\nfour\n',
      },
    })

    expect(wrapper.findAll('[data-testid="files-preview-text-lines"] p')
      .map(line => line.text())).toEqual(['one', 'two', 'three'])
    expect(wrapper.get('[data-testid="files-preview-text-meta"]').text())
      .toBe('5 lines, 30 B')
    expect(wrapper.text()).toContain('Pasted text')
    expect(mocks.fetchTextFileContent).not.toHaveBeenCalled()
  })

  it('uses the singular for a one-line text', async () => {
    const wrapper = await mountSuspended(TextCard, {
      props: {
        file: { name: 'Pasted text', type: 'text/plain', size: 3 },
        content: 'one',
      },
    })

    expect(wrapper.get('[data-testid="files-preview-text-meta"]').text())
      .toBe('1 line, 3 B')
  })

  it('emits open when clicked', async () => {
    const wrapper = await mountSuspended(TextCard, {
      props: {
        file: { name: 'Pasted text', type: 'text/plain', size: 3 },
        content: 'one',
      },
    })

    await wrapper.get('[data-testid="files-preview-text-open"]')
      .trigger('click')

    expect(wrapper.emitted('open')).toHaveLength(1)
    expect(wrapper.get('[data-testid="files-preview-text-open"]')
      .attributes('aria-label')).toBe('Open Pasted text')
  })

  it('fetches a stored text file for its preview', async () => {
    const wrapper = await mountSuspended(TextCard, {
      props: {
        file: {
          storageKey: 'card-fetch-key',
          name: 'notes.md',
          type: 'text/markdown',
          size: 24,
        },
      },
    })

    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.findAll('[data-testid="files-preview-text-lines"] p')
        .map(line => line.text())).toEqual(['fetched one', 'fetched two'])
    })
    expect(mocks.fetchTextFileContent)
      .toHaveBeenCalledWith('/files/card-fetch-key')
    expect(wrapper.get('[data-testid="files-preview-text-meta"]').text())
      .toBe('2 lines, 24 B')
  })

  it('does not fetch a stored file above the preview limit', async () => {
    const wrapper = await mountSuspended(TextCard, {
      props: {
        file: {
          storageKey: 'card-large-key',
          name: 'big.txt',
          type: 'text/plain',
          size: 1024 * 1024,
        },
      },
    })

    await flushPromises()

    expect(mocks.fetchTextFileContent).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="files-preview-text-meta"]').text())
      .toBe('1.0 MB')
  })
})
