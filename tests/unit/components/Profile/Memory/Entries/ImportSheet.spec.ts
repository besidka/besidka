import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_IMPORT_PROMPT } from '../../../../../../shared/utils/memory-import-prompt'
import ImportSheet from '../../../../../../app/components/Profile/Memory/Entries/ImportSheet.client.vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  writeText: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useLegalConsent', () => () => ({
  ensureSendConsent: async () => true,
  handleConsentError: async () => false,
}))
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useErrorMessage', () => mocks.error)

enableAutoUnmount(afterEach)

const IMPORT_URL = '/api/v1/memory/import'
const MAX_CHARS = 60000

interface ImportResponse {
  created: number
  updated: number
  appended: number
  dropped: Record<string, number>
  blocked: Record<string, number>
  chunks: number
  truncated: boolean
  consumedChars: number
  model: { source: string, modelId: string } | null
}

function createResponse(
  overrides: Partial<ImportResponse> = {},
): ImportResponse {
  return {
    created: 0,
    updated: 0,
    appended: 0,
    dropped: {},
    blocked: {},
    chunks: 1,
    truncated: false,
    consumedChars: 0,
    model: null,
    ...overrides,
  }
}

function createFetchError(
  status: number,
  body: { message: string, why?: string, fix?: string },
  retryAfter: string | null = null,
) {
  return Object.assign(new Error('Request failed'), {
    statusCode: status,
    response: {
      headers: {
        get: (name: string) => {
          return name.toLowerCase() === 'retry-after' ? retryAfter : null
        },
      },
    },
    data: {
      statusCode: status,
      message: body.message,
      data: { why: body.why, fix: body.fix },
    },
  })
}

async function mountSheet() {
  const wrapper = await mountSuspended(ImportSheet, {
    props: { open: false },
    global: { stubs: { Teleport: true } },
  })

  await wrapper.setProps({ open: true })
  await flushPromises()

  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountSheet>>

function byTestId<T extends Element = Element>(
  wrapper: Wrapper,
  testId: string,
) {
  return wrapper.get<T>(`[data-testid="${testId}"]`)
}

function has(wrapper: Wrapper, testId: string): boolean {
  return wrapper.find(`[data-testid="${testId}"]`).exists()
}

function isDisabled(wrapper: Wrapper, testId: string): boolean {
  return byTestId(wrapper, testId).classes().includes('btn-disabled')
}

async function typeText(wrapper: Wrapper, value: string) {
  await byTestId<HTMLTextAreaElement>(wrapper, 'memory-import-textarea')
    .setValue(value)
  await flushPromises()
}

async function submit(wrapper: Wrapper, testId = 'memory-import-submit') {
  await byTestId(wrapper, testId).trigger('click')
  await flushPromises()
}

function textareaValue(wrapper: Wrapper): string {
  return byTestId<HTMLTextAreaElement>(wrapper, 'memory-import-textarea')
    .element.value
}

describe('Profile/Memory/Entries/ImportSheet', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.success.mockReset()
    mocks.error.mockReset()
    mocks.writeText.mockReset()
    mocks.writeText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mocks.writeText },
      configurable: true,
    })
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

  describe('layout', () => {
    it('opens a labelled bottom-sheet dialog with fixed header and footer',
      async () => {
        const wrapper = await mountSheet()
        const dialog = wrapper.get('dialog')
        const box = wrapper.get('.modal-box')

        expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
        expect(dialog.classes()).toEqual(expect.arrayContaining([
          'js-memory-import-modal',
          'modal',
          'modal-bottom',
          'sm:modal-middle',
        ]))
        expect(dialog.attributes('aria-labelledby')).toBe(
          byTestId(wrapper, 'memory-import-title').attributes('id'),
        )
        expect(box.classes()).toContain('flex-col')
        expect(box.element.firstElementChild!.classList.contains('shrink-0'))
          .toBe(true)
        expect(box.element.lastElementChild!.classList.contains('shrink-0'))
          .toBe(true)
        expect(box.find('.overflow-y-auto').exists()).toBe(true)
      })

    it('shows the suggested prompt in a read-only rounded box', async () => {
      const wrapper = await mountSheet()
      const prompt = byTestId(wrapper, 'memory-import-prompt')

      expect(prompt.element.textContent).toBe(MEMORY_IMPORT_PROMPT)
      expect(prompt.classes()).toContain('whitespace-pre-wrap')
      expect(prompt.element.parentElement!.className)
        .toContain('rounded-box')
      expect(prompt.element.parentElement!.className)
        .toContain('overflow-y-auto')
    })

    it('uses rounded-box for the textarea and no pill radius', async () => {
      const wrapper = await mountSheet()
      const textarea = byTestId(wrapper, 'memory-import-textarea')

      expect(textarea.classes()).toEqual(expect.arrayContaining([
        'textarea',
        'textarea-bordered',
        'rounded-box',
        'resize-none',
        'overflow-y-auto',
        'min-h-48',
        'max-h-[60dvh]',
      ]))
      expect(textarea.attributes('placeholder'))
        .toBe('Paste what the other assistant answered')
      expect(wrapper.html()).not.toContain('rounded-full')
    })
  })

  describe('copy prompt', () => {
    it('copies the prompt without awaiting anything first', async () => {
      const wrapper = await mountSheet()

      await byTestId(wrapper, 'memory-import-copy').trigger('click')
      await flushPromises()

      expect(mocks.writeText).toHaveBeenCalledExactlyOnceWith(
        MEMORY_IMPORT_PROMPT,
      )
      expect(mocks.success).toHaveBeenCalledWith('Copied')
      expect(mocks.error).not.toHaveBeenCalled()
    })

    it('shows an error toast when the clipboard is refused', async () => {
      mocks.writeText.mockRejectedValue(new Error('denied'))

      const wrapper = await mountSheet()

      await byTestId(wrapper, 'memory-import-copy').trigger('click')
      await flushPromises()

      expect(mocks.error).toHaveBeenCalledWith(
        'Failed to copy the prompt',
        'denied',
      )
      expect(mocks.success).not.toHaveBeenCalled()
    })
  })

  describe('counter and limit', () => {
    it('counts characters live and disables Import while empty',
      async () => {
        const wrapper = await mountSheet()

        expect(byTestId(wrapper, 'memory-import-counter').text())
          .toBe(`0 / ${MAX_CHARS}`)
        expect(isDisabled(wrapper, 'memory-import-submit')).toBe(true)

        await typeText(wrapper, 'Backend developer')

        expect(byTestId(wrapper, 'memory-import-counter').text())
          .toBe(`17 / ${MAX_CHARS}`)
        expect(isDisabled(wrapper, 'memory-import-submit')).toBe(false)
      })

    it('keeps Import disabled for whitespace-only text', async () => {
      const wrapper = await mountSheet()

      await typeText(wrapper, '  \n  ')

      expect(isDisabled(wrapper, 'memory-import-submit')).toBe(true)
    })

    it('accepts exactly the limit and blocks one character more',
      async () => {
        const wrapper = await mountSheet()

        await typeText(wrapper, 'a'.repeat(MAX_CHARS))

        expect(isDisabled(wrapper, 'memory-import-submit')).toBe(false)
        expect(byTestId(wrapper, 'memory-import-counter').classes())
          .not.toContain('text-error')

        await typeText(wrapper, 'a'.repeat(MAX_CHARS + 1))

        expect(isDisabled(wrapper, 'memory-import-submit')).toBe(true)
        expect(byTestId(wrapper, 'memory-import-counter').classes())
          .toContain('text-error')
        expect(byTestId(wrapper, 'memory-import-textarea').classes())
          .toContain('textarea-error')

        await submit(wrapper)

        expect(mocks.fetch).not.toHaveBeenCalled()
      })
  })

  describe('importing', () => {
    it('sends the text exactly as pasted, without trimming', async () => {
      mocks.fetch.mockResolvedValue(createResponse())

      const wrapper = await mountSheet()
      const pasted = '\n  Career\n- Backend dev  \n\n'

      await typeText(wrapper, pasted)
      await submit(wrapper)

      expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(IMPORT_URL, {
        method: 'POST',
        body: { text: pasted },
      })
    })

    it('shows a spinner and disables the form while running', async () => {
      let resolveImport: (value: ImportResponse) => void = () => {}

      mocks.fetch.mockReturnValue(new Promise((resolve) => {
        resolveImport = resolve
      }))

      const wrapper = await mountSheet()

      await typeText(wrapper, 'Backend developer')
      await submit(wrapper)

      const button = byTestId(wrapper, 'memory-import-submit')

      expect(button.text()).toContain('Importing...')
      expect(button.classes()).toContain('btn-disabled')
      expect(wrapper.find('.loading-spinner').exists()).toBe(true)
      expect(byTestId<HTMLTextAreaElement>(
        wrapper,
        'memory-import-textarea',
      ).element.disabled).toBe(true)

      resolveImport(createResponse({ created: 1, consumedChars: 17 }))
      await flushPromises()

      expect(has(wrapper, 'memory-import-summary')).toBe(true)
    })

    it('summarises counts, dropped reasons, blocked kinds and the model',
      async () => {
        mocks.fetch.mockResolvedValue(createResponse({
          created: 3,
          updated: 2,
          appended: 1,
          dropped: {
            'sensitive-topic': 2,
            'never-store': 1,
            'duplicate': 4,
            'ungrounded': 5,
            'mystery-reason': 7,
          },
          blocked: { 'payment-card': 2, 'surprise-kind': 1 },
          chunks: 2,
          consumedChars: 17,
          model: { source: 'direct', modelId: 'unknown-model-id' },
        }))

        const wrapper = await mountSheet()

        await typeText(wrapper, 'Backend developer')
        await submit(wrapper)

        expect(byTestId(wrapper, 'memory-import-created').text()).toBe('3')
        expect(byTestId(wrapper, 'memory-import-updated').text()).toBe('2')
        expect(byTestId(wrapper, 'memory-import-appended').text()).toBe('1')

        const dropped = byTestId(wrapper, 'memory-import-dropped').text()

        expect(dropped).toContain('Sensitive topics (never saved)')
        expect(dropped).toContain('Private data (never saved)')
        expect(dropped).toContain('Already remembered')
        expect(dropped).toContain('No supporting detail')
        expect(byTestId(wrapper, 'memory-import-dropped-sensitive-topic')
          .text()).toContain('2')
        expect(byTestId(wrapper, 'memory-import-dropped-duplicate').text())
          .toContain('4')
        expect(byTestId(wrapper, 'memory-import-dropped-mystery-reason')
          .text()).toBe('mystery-reason7')

        expect(byTestId(wrapper, 'memory-import-blocked-payment-card').text())
          .toBe('Payment card numbers2')
        expect(byTestId(wrapper, 'memory-import-blocked-surprise-kind').text())
          .toBe('surprise-kind1')

        expect(byTestId(wrapper, 'memory-import-meta').text())
          .toContain('Read in 2 parts')
        expect(byTestId(wrapper, 'memory-import-meta').text())
          .toContain('unknown-model-id')
        expect(wrapper.html()).not.toContain('Backend developer')
      })

    it('omits the dropped and blocked blocks when there are none',
      async () => {
        mocks.fetch.mockResolvedValue(createResponse({
          created: 1,
          consumedChars: 5,
        }))

        const wrapper = await mountSheet()

        await typeText(wrapper, 'Hello')
        await submit(wrapper)

        expect(has(wrapper, 'memory-import-dropped')).toBe(false)
        expect(has(wrapper, 'memory-import-blocked')).toBe(false)
        expect(byTestId(wrapper, 'memory-import-meta').text())
          .toContain('Read in 1 part')
      })

    it('emits changed after something was saved and offers Done',
      async () => {
        mocks.fetch.mockResolvedValue(createResponse({
          appended: 1,
          consumedChars: 5,
        }))

        const wrapper = await mountSheet()

        await typeText(wrapper, 'Hello')
        await submit(wrapper)

        expect(wrapper.emitted('changed')).toHaveLength(1)
        expect(has(wrapper, 'memory-import-done')).toBe(true)
        expect(has(wrapper, 'memory-import-more')).toBe(true)
        expect(has(wrapper, 'memory-import-submit')).toBe(false)

        await byTestId(wrapper, 'memory-import-done').trigger('click')
        await flushPromises()

        expect(wrapper.emitted('update:open')).toEqual([[false]])
      })

    it('does not emit changed when nothing was saved', async () => {
      mocks.fetch.mockResolvedValue(createResponse({
        dropped: { duplicate: 3 },
        consumedChars: 5,
      }))

      const wrapper = await mountSheet()

      await typeText(wrapper, 'Hello')
      await submit(wrapper)

      expect(wrapper.emitted('changed')).toBeUndefined()
      expect(byTestId(wrapper, 'memory-import-dropped-duplicate').text())
        .toContain('3')
    })

    it('clears the textarea after success and starts over on Import more',
      async () => {
        mocks.fetch.mockResolvedValue(createResponse({
          created: 1,
          consumedChars: 5,
        }))

        const wrapper = await mountSheet()

        await typeText(wrapper, 'Hello')
        await submit(wrapper)

        expect(textareaValue(wrapper)).toBe('')

        await byTestId(wrapper, 'memory-import-more').trigger('click')
        await flushPromises()

        expect(has(wrapper, 'memory-import-summary')).toBe(false)
        expect(textareaValue(wrapper)).toBe('')
        expect(byTestId(wrapper, 'memory-import-counter').text())
          .toBe(`0 / ${MAX_CHARS}`)
        expect(has(wrapper, 'memory-import-submit')).toBe(true)
      })
  })

  describe('truncated import', () => {
    const FIRST_PART = 'Career\n- Backend dev\n'
    const REMAINDER = 'Hobbies\n- Climbing\n'

    async function mountTruncated() {
      mocks.fetch.mockResolvedValueOnce(createResponse({
        created: 2,
        chunks: 3,
        truncated: true,
        consumedChars: FIRST_PART.length,
        dropped: { duplicate: 1 },
        blocked: { 'api-key': 1 },
        model: { source: 'direct', modelId: 'm1' },
      }))

      const wrapper = await mountSheet()

      await typeText(wrapper, FIRST_PART + REMAINDER)
      await submit(wrapper)

      return wrapper
    }

    it('says part of the text was not read and offers Continue',
      async () => {
        const wrapper = await mountTruncated()

        expect(byTestId(wrapper, 'memory-import-truncated').text())
          .toContain('Part of your text was not read yet')
        expect(has(wrapper, 'memory-import-continue')).toBe(true)
        expect(has(wrapper, 'memory-import-submit')).toBe(false)
        expect(has(wrapper, 'memory-import-done')).toBe(false)
        expect(wrapper.emitted('changed')).toHaveLength(1)
      })

    it('replaces the textarea with the unread remainder and keeps the counter right',
      async () => {
        const wrapper = await mountTruncated()

        expect(textareaValue(wrapper)).toBe(REMAINDER)
        expect(byTestId(wrapper, 'memory-import-counter').text())
          .toBe(`${REMAINDER.length} / ${MAX_CHARS}`)
      })

    it('sends exactly the remainder on Continue and adds up the totals',
      async () => {
        const wrapper = await mountTruncated()

        mocks.fetch.mockResolvedValueOnce(createResponse({
          created: 1,
          updated: 1,
          chunks: 1,
          consumedChars: REMAINDER.length,
          dropped: { duplicate: 2 },
          blocked: { 'api-key': 2 },
        }))

        await submit(wrapper, 'memory-import-continue')

        expect(mocks.fetch).toHaveBeenLastCalledWith(IMPORT_URL, {
          method: 'POST',
          body: { text: REMAINDER },
        })
        expect(byTestId(wrapper, 'memory-import-created').text()).toBe('3')
        expect(byTestId(wrapper, 'memory-import-updated').text()).toBe('1')
        expect(byTestId(wrapper, 'memory-import-dropped-duplicate').text())
          .toContain('3')
        expect(byTestId(wrapper, 'memory-import-blocked-api-key').text())
          .toContain('1')
        expect(byTestId(wrapper, 'memory-import-blocked-api-key').text())
          .not.toContain('3')
        expect(byTestId(wrapper, 'memory-import-meta').text())
          .toContain('Read in 4 parts')
        expect(byTestId(wrapper, 'memory-import-meta').text())
          .toContain('m1')
        expect(has(wrapper, 'memory-import-done')).toBe(true)
        expect(textareaValue(wrapper)).toBe('')
        expect(wrapper.emitted('changed')).toHaveLength(2)
      })

    it('finishes when the unread remainder is only whitespace', async () => {
      mocks.fetch.mockResolvedValue(createResponse({
        created: 1,
        truncated: true,
        consumedChars: 5,
      }))

      const wrapper = await mountSheet()

      await typeText(wrapper, 'Hello\n  \n')
      await submit(wrapper)

      expect(has(wrapper, 'memory-import-continue')).toBe(false)
      expect(has(wrapper, 'memory-import-done')).toBe(true)
    })
  })

  describe('errors', () => {
    async function failWith(error: unknown) {
      mocks.fetch.mockRejectedValue(error)

      const wrapper = await mountSheet()

      await typeText(wrapper, 'Backend developer')
      await submit(wrapper)

      return wrapper
    }

    it('shows a 422 refusal inline with message, why and fix', async () => {
      const wrapper = await failWith(createFetchError(422, {
        message: 'Nothing was saved',
        why: 'The text contains a payment card number.',
        fix: 'Remove the number and try again.',
      }))
      const alert = byTestId(wrapper, 'memory-import-error')

      expect(alert.attributes('role')).toBe('alert')
      expect(alert.classes()).toEqual(expect.arrayContaining([
        'alert',
        'alert-soft',
        'alert-error',
      ]))
      expect(alert.get('p').classes()).toContain('font-bold')
      expect(alert.text()).toContain('Nothing was saved')
      expect(alert.text()).toContain('The text contains a payment card number.')
      expect(alert.text()).toContain('Remove the number and try again.')
      expect(mocks.error).not.toHaveBeenCalled()
    })

    it('shows the 400 nothing-to-import message inline', async () => {
      const wrapper = await failWith(createFetchError(400, {
        message: 'Nothing to import',
        why: 'The text had no content that can be stored.',
        fix: 'Paste the list your other assistant wrote.',
      }))
      const alert = byTestId(wrapper, 'memory-import-error')

      expect(alert.text()).toContain('Nothing to import')
      expect(alert.text()).toContain('Paste the list your other assistant wrote.')
      expect(alert.text()).not.toContain('Backend developer')
    })

    it('shows the 409 no-model message inline', async () => {
      const wrapper = await failWith(createFetchError(409, {
        message: 'No model available for memory import',
        why: 'No saved API key matches a model that can read your text.',
        fix: 'Add an API key for a provider in settings, then try again.',
      }))

      expect(byTestId(wrapper, 'memory-import-error').text())
        .toContain('No model available for memory import')
      expect(has(wrapper, 'memory-import-warning')).toBe(false)
    })

    it('shows a 429 as a friendly inline warning, not an error',
      async () => {
        const wrapper = await failWith(createFetchError(429, {
          message: 'Memory import already requested',
          why: 'An import was requested less than a minute ago.',
          fix: 'Wait a minute, then try again.',
        }))
        const warning = byTestId(wrapper, 'memory-import-warning')

        expect(warning.attributes('role')).toBe('status')
        expect(warning.classes()).toEqual(expect.arrayContaining([
          'alert',
          'alert-soft',
          'alert-warning',
        ]))
        expect(warning.text()).toContain(
          'Wait a minute before importing again',
        )
        expect(has(wrapper, 'memory-import-error')).toBe(false)
        expect(mocks.error).not.toHaveBeenCalled()
      })

    it('uses the Retry-After seconds when the response carries them',
      async () => {
        const wrapper = await failWith(createFetchError(
          429,
          { message: 'Memory import already requested' },
          '42',
        ))

        expect(byTestId(wrapper, 'memory-import-warning').text())
          .toContain('Try again in 42 seconds.')
      })

    it('keeps the pasted text after a failure and clears the error on retry',
      async () => {
        const wrapper = await failWith(createFetchError(502, {
          message: 'Memory import failed',
        }))

        expect(textareaValue(wrapper)).toBe('Backend developer')
        expect(has(wrapper, 'memory-import-submit')).toBe(true)

        mocks.fetch.mockResolvedValue(createResponse({
          created: 1,
          consumedChars: 17,
        }))
        await submit(wrapper)

        expect(has(wrapper, 'memory-import-error')).toBe(false)
        expect(has(wrapper, 'memory-import-done')).toBe(true)
        expect(textareaValue(wrapper)).toBe('')
      })

    it('keeps the pasted text when the sheet is closed after a failure',
      async () => {
        const wrapper = await failWith(createFetchError(422, {
          message: 'Nothing was saved',
        }))

        await byTestId(wrapper, 'memory-import-cancel').trigger('click')
        await flushPromises()
        await wrapper.setProps({ open: false })
        await wrapper.setProps({ open: true })
        await flushPromises()

        expect(textareaValue(wrapper)).toBe('Backend developer')
        expect(has(wrapper, 'memory-import-error')).toBe(false)
      })

    it('starts fresh after a finished import is closed', async () => {
      mocks.fetch.mockResolvedValue(createResponse({
        created: 1,
        consumedChars: 5,
      }))

      const wrapper = await mountSheet()

      await typeText(wrapper, 'Hello')
      await submit(wrapper)
      await byTestId(wrapper, 'memory-import-done').trigger('click')
      await flushPromises()
      await wrapper.setProps({ open: false })
      await wrapper.setProps({ open: true })
      await flushPromises()

      expect(has(wrapper, 'memory-import-summary')).toBe(false)
      expect(has(wrapper, 'memory-import-submit')).toBe(true)
      expect(textareaValue(wrapper)).toBe('')
    })
  })
})
