import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, shallowRef } from 'vue'
import TextFileModal from '../../../../app/components/Chat/TextFileModal.client.vue'

const mocks = vi.hoisted(() => ({
  fetchTextFileContent: vi.fn(),
  copy: vi.fn(async () => {}),
  useSuccessMessage: vi.fn(),
  useConfirm: vi.fn(),
  useDevice: vi.fn(),
}))

const isCenteredLayout = shallowRef<boolean>(true)
const bottomInset = shallowRef<number>(0)
const viewportHeight = shallowRef<number>(800)
const isKeyboardOpen = computed<boolean>(() => bottomInset.value >= 120)

mockNuxtImport('fetchTextFileContent', () => mocks.fetchTextFileContent)
mockNuxtImport('useClipboard', () => () => ({ copy: mocks.copy }))
mockNuxtImport('useSuccessMessage', () => mocks.useSuccessMessage)
mockNuxtImport('useConfirm', () => mocks.useConfirm)
mockNuxtImport('useDevice', () => mocks.useDevice)
mockNuxtImport('useMediaQuery', () => () => isCenteredLayout)
mockNuxtImport('useVisualViewportInset', () => () => ({
  bottomInset,
  viewportHeight,
  isKeyboardOpen,
  update: vi.fn(),
}))

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
    global: {
      stubs: {
        teleport: false,
      },
    },
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
    mocks.useConfirm.mockReset()
    mocks.useConfirm.mockResolvedValue({ label: 'Discard', index: 0 })
    mocks.useDevice.mockReturnValue({ isDesktop: true })
    isCenteredLayout.value = true
    bottomInset.value = 0
    viewportHeight.value = 800
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

  describe('closing with unsaved edits', () => {
    async function editDraft(content: string) {
      const textarea = getInBody('text-file-modal-textarea') as
        HTMLTextAreaElement

      textarea.value = content
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await flushPromises()
    }

    function dispatchCancel() {
      const event = new Event('cancel', { cancelable: true })

      getInBody('text-file-modal').dispatchEvent(event)

      return event
    }

    function submitForm(form: Element | null) {
      const event = new Event('submit', { bubbles: true, cancelable: true })

      form?.dispatchEvent(event)

      return event
    }

    it('asks before Cancel discards edits and keeps editing when declined',
      async () => {
        mocks.useConfirm.mockResolvedValue(null)

        const wrapper = await mountModal({ content: 'body' })
        await flushPromises()
        await editDraft('body changed')

        getInBody('text-file-modal-cancel').click()
        await flushPromises()

        expect(mocks.useConfirm).toHaveBeenCalledWith(expect.objectContaining({
          text: 'Discard your unsaved changes?',
        }))
        expect(wrapper.emitted('update:open')).toBeUndefined()
        expect(
          (getInBody('text-file-modal-textarea') as HTMLTextAreaElement).value,
        ).toBe('body changed')
      })

    it('closes after the discard is confirmed', async () => {
      const wrapper = await mountModal({ content: 'body' })
      await flushPromises()
      await editDraft('body changed')

      getInBody('text-file-modal-cancel').click()
      await flushPromises()

      expect(mocks.useConfirm).toHaveBeenCalledTimes(1)
      expect(wrapper.emitted('update:open')).toEqual([[false]])
    })

    it('does not ask when nothing changed', async () => {
      const wrapper = await mountModal({ content: 'body' })
      await flushPromises()

      getInBody('text-file-modal-cancel').click()
      await flushPromises()

      expect(mocks.useConfirm).not.toHaveBeenCalled()
      expect(wrapper.emitted('update:open')).toEqual([[false]])
    })

    it('does not ask once the edit is reverted', async () => {
      const wrapper = await mountModal({ content: 'body' })
      await flushPromises()
      await editDraft('body changed')
      await editDraft('body')

      getInBody('text-file-modal-cancel').click()
      await flushPromises()

      expect(mocks.useConfirm).not.toHaveBeenCalled()
      expect(wrapper.emitted('update:open')).toEqual([[false]])
    })

    it('intercepts Escape, the close button and the backdrop', async () => {
      mocks.useConfirm.mockResolvedValue(null)

      const wrapper = await mountModal({ content: 'body' })
      await flushPromises()
      await editDraft('body changed')

      const escapeEvent = dispatchCancel()
      await flushPromises()
      const closeEvent = submitForm(
        getInBody('text-file-modal-close').closest('form'),
      )
      await flushPromises()
      const backdropEvent = submitForm(
        getInBody('text-file-modal').querySelector('.modal-backdrop'),
      )
      await flushPromises()

      expect(escapeEvent.defaultPrevented).toBe(true)
      expect(closeEvent.defaultPrevented).toBe(true)
      expect(backdropEvent.defaultPrevented).toBe(true)
      expect(mocks.useConfirm).toHaveBeenCalledTimes(3)
      expect(wrapper.emitted('update:open')).toBeUndefined()
    })

    it('closes on Escape without asking when nothing changed', async () => {
      const wrapper = await mountModal({ content: 'body' })
      await flushPromises()

      dispatchCancel()
      await flushPromises()

      expect(mocks.useConfirm).not.toHaveBeenCalled()
      expect(wrapper.emitted('update:open')).toEqual([[false]])
    })

    it('never asks for a read-only file', async () => {
      mocks.fetchTextFileContent.mockResolvedValue('body')

      const wrapper = await mountModal({
        name: 'notes.md',
        url: '/files/notes-key',
        isReadonly: true,
      })
      await flushPromises()

      dispatchCancel()
      await flushPromises()

      expect(mocks.useConfirm).not.toHaveBeenCalled()
      expect(wrapper.emitted('update:open')).toEqual([[false]])
    })

    it('shows one confirmation for repeated close requests', async () => {
      let resolveConfirm: (result: null) => void = () => {}

      mocks.useConfirm.mockReturnValue(new Promise((resolve) => {
        resolveConfirm = resolve
      }))

      await mountModal({ content: 'body' })
      await flushPromises()
      await editDraft('body changed')

      dispatchCancel()
      dispatchCancel()
      await flushPromises()

      expect(mocks.useConfirm).toHaveBeenCalledTimes(1)

      resolveConfirm(null)
      await flushPromises()
    })
  })

  describe('opening focus', () => {
    function emulateIosShowModal() {
      vi.spyOn(HTMLDialogElement.prototype, 'showModal')
        .mockImplementation(function (this: HTMLDialogElement) {
          this.setAttribute('open', '')

          const firstLinkOrField = Array.from(
            this.querySelectorAll<HTMLElement>('a[href], input, textarea'),
          ).find((element) => {
            return !element.closest('[inert]')
          })

          firstLinkOrField?.focus()
        })
    }

    const focusTracker = new AbortController()

    afterEach(() => {
      focusTracker.abort()
    })

    function trackFocusedElements(): EventTarget[] {
      const focusedElements: EventTarget[] = []

      document.addEventListener('focusin', (event) => {
        if (event.target) {
          focusedElements.push(event.target)
        }
      }, { signal: focusTracker.signal })

      return focusedElements
    }

    it('never lets the textarea take focus on a touch sheet when showModal ignores autofocus (iOS)',
      async () => {
        emulateIosShowModal()
        mocks.useDevice.mockReturnValue({ isDesktop: false })
        isCenteredLayout.value = false

        const focusedElements = trackFocusedElements()

        await mountModal({ content: 'body', canInsert: true })
        await flushPromises()

        const textarea = getInBody('text-file-modal-textarea')

        expect(focusedElements).not.toContain(textarea)
        expect(document.activeElement).not.toBe(textarea)
        expect(document.activeElement).toBe(
          getInBody('text-file-modal-close'),
        )
        expect(textarea.closest('[inert]')).toBeNull()
      })

    it('does not focus the textarea below the centered breakpoint on desktop',
      async () => {
        isCenteredLayout.value = false

        await mountModal({ content: 'body' })
        await flushPromises()

        expect(document.activeElement).not.toBe(
          getInBody('text-file-modal-textarea'),
        )
      })

    it('keeps the read-only file links from taking focus on iOS', async () => {
      emulateIosShowModal()
      mocks.useDevice.mockReturnValue({ isDesktop: false })
      isCenteredLayout.value = false
      mocks.fetchTextFileContent.mockResolvedValue('body')

      await mountModal({
        name: 'notes.md',
        url: '/files/notes-key',
        downloadUrl: '/files/notes-key?download=1',
        isReadonly: true,
      })
      await flushPromises()

      expect(document.activeElement).toBe(getInBody('text-file-modal-close'))
      expect(getInBody('text-file-modal-raw').closest('[inert]')).toBeNull()
    })

    it('focuses the textarea on desktop', async () => {
      emulateIosShowModal()

      await mountModal({ content: 'body' })
      await flushPromises()

      expect(document.activeElement).toBe(getInBody('text-file-modal-textarea'))
    })

    it('does not focus a read-only file on desktop', async () => {
      mocks.fetchTextFileContent.mockResolvedValue('body')

      await mountModal({
        name: 'notes.md',
        url: '/files/notes-key',
        isReadonly: true,
      })
      await flushPromises()

      expect(document.activeElement).not.toBe(getInBody('text-file-modal-content'))
    })
  })

  describe('with the on-screen keyboard up', () => {
    function getBox(): HTMLElement {
      return getInBody('text-file-modal-box')
    }

    it('sits on the visual viewport above the keyboard on a sheet',
      async () => {
        isCenteredLayout.value = false

        await mountModal({ content: 'body', canInsert: true })
        await flushPromises()

        expect(getBox().style.height).toBe('')
        expect(getInBody('text-file-modal-textarea').className)
          .toContain('min-h-64')

        viewportHeight.value = 400
        bottomInset.value = 400
        await nextTick()

        expect(getBox().style.height).toBe('340px')
        expect(getBox().style.maxHeight).toBe('340px')
        expect(getBox().style.marginBottom).toBe('400px')
        expect(
          getBox().style.getPropertyValue('--text-file-sheet-bottom-padding'),
        ).toBe('0.375rem')
        expect(getInBody('text-file-modal-textarea').className)
          .toContain('min-h-24')
        expect(getInBody('text-file-modal-textarea').className)
          .not.toContain('min-h-64')
        expect(getInBody('text-file-modal-counter')).not.toBeNull()
        expect(getInBody('text-file-modal-insert')).not.toBeNull()
        expect(getInBody('text-file-modal-cancel')).not.toBeNull()
        expect(getInBody('text-file-modal-save')).not.toBeNull()

        bottomInset.value = 0
        viewportHeight.value = 800
        await nextTick()

        expect(getBox().style.height).toBe('')
        expect(getBox().style.marginBottom).toBe('')
      })

    it('never lifts the centered modal', async () => {
      await mountModal({ content: 'body' })
      await flushPromises()

      viewportHeight.value = 400
      bottomInset.value = 400
      await nextTick()

      expect(getBox().style.height).toBe('')
      expect(getBox().style.marginBottom).toBe('')
    })

    it('keeps a read-only file working while lifted', async () => {
      isCenteredLayout.value = false
      mocks.fetchTextFileContent.mockResolvedValue('body')

      await mountModal({
        name: 'notes.md',
        url: '/files/notes-key',
        isReadonly: true,
      })
      await flushPromises()

      viewportHeight.value = 400
      bottomInset.value = 400
      await nextTick()

      expect(getBox().style.marginBottom).toBe('400px')
      expect(getInBody('text-file-modal-content').textContent).toBe('body')
      expect(getInBody('text-file-modal-copy')).not.toBeNull()
    })
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
