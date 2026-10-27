import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeItem } from '../../../../../shared/types/project-knowledge.d'
import ItemEditSheet from '../../../../../app/components/Projects/Knowledge/ItemEditSheet.client.vue'
import { createKnowledgeItem } from '../../../../setup/helpers/knowledge-ui-fixtures'

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  patchItem: vi.fn(),
  allowItem: vi.fn(),
}))

mockNuxtImport('useInfoMessage', () => mocks.info)

enableAutoUnmount(afterEach)

const scannedPdf = createKnowledgeItem({
  id: 'pdf-1',
  title: 'scan.pdf',
  fileId: 'file-1',
  mediaType: 'application/pdf',
  extractor: 'client-unpdf',
  extractStatus: 'no-text',
  pageCount: 3,
  sizeBytes: 500_000,
  textBytes: 0,
  latinChars: 0,
})

interface SheetOptions {
  item?: KnowledgeItem | null
  canSendPdf?: boolean
  tokens?: number | null
}

async function mountSheet(options: SheetOptions = {}) {
  const wrapper = await mountSuspended(ItemEditSheet, {
    props: {
      item: options.item === undefined ? createKnowledgeItem() : options.item,
      tokens: options.tokens === undefined ? 300 : options.tokens,
      modelName: 'Test Model',
      canSendPdf: options.canSendPdf ?? true,
      patchItem: mocks.patchItem,
      allowItem: mocks.allowItem,
      open: false,
    },
    global: {
      stubs: { Teleport: true },
    },
  })

  await wrapper.setProps({ open: true })
  await flushPromises()

  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountSheet>>

function byTestId(wrapper: Wrapper, id: string) {
  return wrapper.get(`[data-testid="${id}"]`)
}

describe('Projects/Knowledge/ItemEditSheet', () => {
  beforeEach(() => {
    mocks.info.mockReset()
    mocks.patchItem.mockReset()
    mocks.patchItem.mockResolvedValue({ ok: true, result: {} })
    mocks.allowItem.mockReset()
    mocks.allowItem.mockResolvedValue({ ok: true, result: {} })
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function () {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function () {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens a dialog named by the item', async () => {
    const wrapper = await mountSheet()
    const dialog = wrapper.get('dialog')

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
    expect(byTestId(wrapper, 'knowledge-item-sheet-title').element.tagName)
      .toBe('H3')
    expect(dialog.attributes('aria-labelledby')).toBe(
      byTestId(wrapper, 'knowledge-item-sheet-title').attributes('id'),
    )
    expect(byTestId(wrapper, 'knowledge-item-sheet-title').text())
      .toBe('README.md')
  })

  it('shows the kind, size, tokens and status', async () => {
    const wrapper = await mountSheet()

    expect(byTestId(wrapper, 'knowledge-item-sheet-type').text())
      .toBe('Text')
    expect(byTestId(wrapper, 'knowledge-item-sheet-size').text())
      .toBe('1 KB')
    expect(byTestId(wrapper, 'knowledge-item-sheet-tokens').text())
      .toBe('~300 tokens for Test Model')
    expect(byTestId(wrapper, 'knowledge-item-sheet-status').text())
      .toBe('Ready')
    expect(wrapper.find('[data-testid="knowledge-item-sheet-extract-message"]')
      .exists()).toBe(false)
  })

  it('labels the description input and counts its characters', async () => {
    const wrapper = await mountSheet({
      item: createKnowledgeItem({ description: 'Notes' }),
    })
    const input = byTestId(wrapper, 'knowledge-item-sheet-description')

    expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text())
      .toBe('Description')
    expect(byTestId(wrapper, 'knowledge-item-sheet-counter').text())
      .toBe('5 / 100')
    expect(input.attributes('aria-describedby')).toBe(
      byTestId(wrapper, 'knowledge-item-sheet-counter').attributes('id'),
    )
  })

  it('blocks a description over the limit', async () => {
    const wrapper = await mountSheet()

    await byTestId(wrapper, 'knowledge-item-sheet-description')
      .setValue('x'.repeat(101))

    expect(byTestId(wrapper, 'knowledge-item-sheet-description')
      .attributes('aria-invalid')).toBe('true')
    expect(byTestId(wrapper, 'knowledge-item-sheet-counter').classes())
      .toContain('text-error')
    expect(byTestId(wrapper, 'knowledge-item-sheet-save').classes())
      .toContain('btn-disabled')
  })

  it('saves only the changed description and closes with a toast', async () => {
    const wrapper = await mountSheet()
    expect(byTestId(wrapper, 'knowledge-item-sheet-save').classes())
      .toContain('btn-disabled')

    await byTestId(wrapper, 'knowledge-item-sheet-description')
      .setValue('  The readme  ')
    await byTestId(wrapper, 'knowledge-item-sheet-save').trigger('click')
    await flushPromises()

    expect(mocks.patchItem).toHaveBeenCalledWith('item-1', {
      description: 'The readme',
    })
    expect(mocks.info).toHaveBeenCalledWith('Saved', 'Knowledge item updated.')
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('clears the description by sending null', async () => {
    const wrapper = await mountSheet({
      item: createKnowledgeItem({ description: 'Old' }),
    })

    await byTestId(wrapper, 'knowledge-item-sheet-description').setValue('')
    await byTestId(wrapper, 'knowledge-item-sheet-save').trigger('click')
    await flushPromises()

    expect(mocks.patchItem).toHaveBeenCalledWith('item-1', {
      description: null,
    })
  })

  it('shows a failed save inline with message, why and fix', async () => {
    mocks.patchItem.mockResolvedValue({
      ok: false,
      parsed: {
        message: 'Could not save',
        why: 'The project is locked',
        fix: 'Try again in a minute',
      },
    })

    const wrapper = await mountSheet()

    await byTestId(wrapper, 'knowledge-item-sheet-description').setValue('x')
    await byTestId(wrapper, 'knowledge-item-sheet-save').trigger('click')
    await flushPromises()

    const alert = byTestId(wrapper, 'knowledge-item-sheet-error')

    expect(alert.attributes('role')).toBe('alert')
    expect(alert.text()).toContain('Could not save')
    expect(alert.text()).toContain('The project is locked')
    expect(alert.text()).toContain('Try again in a minute')
    expect(mocks.info).not.toHaveBeenCalled()
  })

  describe('scanned PDFs', () => {
    it('explains there is no text and offers the PDF option', async () => {
      const wrapper = await mountSheet({ item: scannedPdf })

      expect(byTestId(wrapper, 'knowledge-item-sheet-status').text())
        .toBe('No text found')
      expect(byTestId(wrapper, 'knowledge-item-sheet-extract-message')
        .text()).toContain('no text')
      expect(byTestId(wrapper, 'knowledge-item-sheet-pdf').text())
        .toContain('This PDF has no readable text')
      expect(byTestId(wrapper, 'knowledge-item-sheet-native-pdf').exists())
        .toBe(true)
      expect(wrapper.text()).toContain(
        'Send as PDF, with images, to models that read PDFs',
      )
      expect(byTestId(wrapper, 'knowledge-item-sheet-transcribe').text())
        .toBe('Transcribing scanned pages with a model is coming soon.')
    })

    it('marks a PDF without text as not screened for prompt injection',
      async () => {
        const wrapper = await mountSheet({ item: scannedPdf })

        expect(byTestId(wrapper, 'knowledge-item-sheet-native-pdf-unscreened')
          .text()).toContain('Not screened for prompt injection')
        expect(wrapper.find(
          '[data-testid="knowledge-item-sheet-native-pdf-text-screened"]',
        ).exists()).toBe(false)
      })

    it('says a PDF with text is screened on its text only', async () => {
      const wrapper = await mountSheet({
        item: {
          ...scannedPdf,
          extractStatus: 'ready',
          textBytes: 1200,
          latinChars: 1200,
        },
      })

      expect(byTestId(wrapper, 'knowledge-item-sheet-native-pdf-text-screened')
        .text()).toContain('extracted text only')
      expect(wrapper.find(
        '[data-testid="knowledge-item-sheet-native-pdf-unscreened"]',
      ).exists()).toBe(false)
    })

    it('saves the native PDF toggle', async () => {
      const wrapper = await mountSheet({ item: scannedPdf })

      await byTestId(wrapper, 'knowledge-item-sheet-native-pdf')
        .setValue(true)
      await byTestId(wrapper, 'knowledge-item-sheet-save').trigger('click')
      await flushPromises()

      expect(mocks.patchItem).toHaveBeenCalledWith('pdf-1', {
        sendAsNativePdf: true,
      })
    })

    it('hides the toggle on a model that cannot read PDFs', async () => {
      const wrapper = await mountSheet({
        item: scannedPdf,
        canSendPdf: false,
      })

      expect(wrapper.find('[data-testid="knowledge-item-sheet-native-pdf"]')
        .exists()).toBe(false)
      expect(byTestId(wrapper, 'knowledge-item-sheet-pdf-hint').text())
        .toContain('Test Model does not read PDFs')
    })

    it('keeps the toggle reachable when it is already on', async () => {
      const wrapper = await mountSheet({
        item: { ...scannedPdf, sendAsNativePdf: true },
        canSendPdf: false,
      })

      expect(byTestId(wrapper, 'knowledge-item-sheet-native-pdf').exists())
        .toBe(true)
    })

    it('does not show PDF options for other files', async () => {
      const wrapper = await mountSheet()

      expect(wrapper.find('[data-testid="knowledge-item-sheet-pdf"]').exists())
        .toBe(false)
    })
  })

  describe('failed extraction', () => {
    const failed = createKnowledgeItem({
      id: 'failed-1',
      extractStatus: 'failed',
      extractError: 'too-large',
    })

    it('shows the readable reason and a way to add the file again',
      async () => {
        const wrapper = await mountSheet({ item: failed })

        expect(byTestId(wrapper, 'knowledge-item-sheet-extract-message')
          .text()).toContain('This file is too large to read.')

        await byTestId(wrapper, 'knowledge-item-sheet-readd')
          .trigger('click')

        expect(wrapper.emitted('readd')).toEqual([[failed]])
      })
  })

  describe('an item flagged as a possible prompt injection', () => {
    const flagged = createKnowledgeItem({
      id: 'flagged-1',
      extractStatus: 'flagged',
    })

    it('explains the flag and offers Allow anyway', async () => {
      const wrapper = await mountSheet({ item: flagged })
      const review = byTestId(wrapper, 'knowledge-item-injection-review')

      expect(byTestId(wrapper, 'knowledge-item-sheet-status').text())
        .toBe('Needs review')
      expect(review.text()).toContain('Possible prompt injection, review it')
      expect(review.text()).toContain('Nothing was deleted.')
      expect(wrapper.find(
        '[data-testid="knowledge-item-sheet-extract-message"]',
      ).exists()).toBe(false)
    })

    it('allows the item and closes', async () => {
      const wrapper = await mountSheet({ item: flagged })

      await byTestId(wrapper, 'knowledge-item-allow').trigger('click')
      await flushPromises()

      expect(mocks.allowItem).toHaveBeenCalledWith('flagged-1')
      expect(mocks.info).toHaveBeenCalledWith(
        'Allowed',
        'This item is used in your chats again.',
      )
      expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
    })

    it('keeps the sheet open with the error when allowing fails',
      async () => {
        mocks.allowItem.mockResolvedValue({
          ok: false,
          parsed: { message: 'This item is not waiting for review' },
        })

        const wrapper = await mountSheet({ item: flagged })

        await byTestId(wrapper, 'knowledge-item-allow').trigger('click')
        await flushPromises()

        expect(byTestId(wrapper, 'knowledge-item-sheet-error').text())
          .toContain('This item is not waiting for review')
        expect(mocks.info).not.toHaveBeenCalled()
      })

    it('shows no review prompt for a ready item', async () => {
      const wrapper = await mountSheet()

      expect(wrapper.find(
        '[data-testid="knowledge-item-injection-review"]',
      ).exists()).toBe(false)
    })
  })

  it('emits remove from the Remove button', async () => {
    const item = createKnowledgeItem()
    const wrapper = await mountSheet({ item })

    await byTestId(wrapper, 'knowledge-item-sheet-remove').trigger('click')

    expect(wrapper.emitted('remove')).toEqual([[item]])
  })

  it('closes from Cancel and the labelled close button', async () => {
    const wrapper = await mountSheet()

    expect(byTestId(wrapper, 'knowledge-item-sheet-close')
      .attributes('aria-label')).toBe('Close')

    await byTestId(wrapper, 'knowledge-item-sheet-cancel').trigger('click')

    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })
})
