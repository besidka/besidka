import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextFileModal from '../../../../app/components/Chat/TextFileModal.client.vue'

const mocks = vi.hoisted(() => ({
  fetchTextFileContent: vi.fn(),
  copy: vi.fn(async () => {}),
  useSuccessMessage: vi.fn(),
}))

mockNuxtImport('fetchTextFileContent', () => mocks.fetchTextFileContent)
mockNuxtImport('useClipboard', () => () => ({ copy: mocks.copy }))
mockNuxtImport('useSuccessMessage', () => mocks.useSuccessMessage)

enableAutoUnmount(afterEach)

function findInBody(testId: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${testId}"]`)
}

function getInBody(testId: string): HTMLElement {
  const element = findInBody(testId)

  if (!element) {
    throw new Error(`Missing ${testId}`)
  }

  return element
}

function mountModal(props: Record<string, unknown>) {
  return mountSuspended(TextFileModal, {
    props: {
      'open': true,
      'name': 'Pasted text',
      'onUpdate:open': vi.fn(),
      ...props,
    },
    attachTo: document.body,
  })
}

describe('Chat/TextFileModal', () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
    mocks.fetchTextFileContent.mockReset()
    mocks.copy.mockClear()
    mocks.useSuccessMessage.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('edits inline content and saves only a changed, non-empty draft',
    async () => {
      const wrapper = await mountModal({
        content: 'one\ntwo',
        canInsert: true,
      })
      await flushPromises()

      const textarea = getInBody('text-file-modal-textarea') as
        HTMLTextAreaElement
      const isSaveDisabled = () => {
        return (getInBody('text-file-modal-save') as HTMLButtonElement).disabled
      }

      expect(textarea.value).toBe('one\ntwo')
      expect(getInBody('text-file-modal-counter').textContent)
        .toContain('7 characters, 2 lines')
      expect(isSaveDisabled()).toBe(true)

      textarea.value = '   '
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await flushPromises()

      expect(isSaveDisabled()).toBe(true)

      textarea.value = 'one\ntwo\nthree'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await flushPromises()

      expect(isSaveDisabled()).toBe(false)

      getInBody('text-file-modal-save').click()

      expect(wrapper.emitted('save')).toEqual([['one\ntwo\nthree']])
    })

  it('inserts the current draft as text', async () => {
    const wrapper = await mountModal({ content: 'body', canInsert: true })
    await flushPromises()

    getInBody('text-file-modal-insert').click()

    expect(wrapper.emitted('insert')).toEqual([['body']])
  })

  it('closes on Cancel without saving', async () => {
    const wrapper = await mountModal({ content: 'body' })
    await flushPromises()

    expect(findInBody('text-file-modal-insert')).toBeNull()

    getInBody('text-file-modal-cancel').click()
    await flushPromises()

    expect(wrapper.emitted('update:open')).toEqual([[false]])
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('loads a stored file read-only with copy, raw and download', async () => {
    mocks.fetchTextFileContent.mockResolvedValue('# Notes\nbody')

    await mountModal({
      name: 'notes.md',
      url: '/files/notes-key',
      downloadUrl: '/files/notes-key?download=1',
      size: 12,
      isReadonly: true,
    })
    await flushPromises()

    expect(mocks.fetchTextFileContent).toHaveBeenCalledWith('/files/notes-key')
    expect(getInBody('text-file-modal-content').textContent)
      .toBe('# Notes\nbody')
    expect(findInBody('text-file-modal-textarea')).toBeNull()
    expect(getInBody('text-file-modal-raw').getAttribute('href'))
      .toBe('/files/notes-key')
    expect(getInBody('text-file-modal-download').getAttribute('href'))
      .toBe('/files/notes-key?download=1')

    getInBody('text-file-modal-copy').click()
    await flushPromises()

    expect(mocks.copy).toHaveBeenCalledWith('# Notes\nbody')
    expect(mocks.useSuccessMessage).toHaveBeenCalledWith('Copied to clipboard')
  })

  it('does not load a stored file above the view limit', async () => {
    await mountModal({
      name: 'huge.txt',
      url: '/files/huge-key',
      size: 3 * 1024 * 1024,
      isReadonly: true,
    })
    await flushPromises()

    expect(mocks.fetchTextFileContent).not.toHaveBeenCalled()
    expect(getInBody('text-file-modal-unavailable').textContent)
      .toContain('larger than')
  })

  it('shows the error when a stored file cannot be loaded', async () => {
    mocks.fetchTextFileContent.mockRejectedValue(new Error('Not found'))

    await mountModal({
      name: 'gone.txt',
      url: '/files/gone-key',
      isReadonly: true,
    })
    await flushPromises()

    expect(getInBody('text-file-modal-unavailable').textContent)
      .toContain('Not found')
  })
})
