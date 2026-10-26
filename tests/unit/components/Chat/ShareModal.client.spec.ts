import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JEV_SHARE_CHECK_DEBOUNCE_MS } from '#shared/utils/jev-policy'
import type { SharePiiCheckResult } from '#shared/types/share-pii.d'
import ShareModal from '../../../../app/components/Chat/ShareModal.client.vue'
import { useChatShare } from '../../../../app/composables/chat-share'
import * as messagesComposable from '../../../../app/composables/messages'

const { useConfirmMock, fetchMock } = vi.hoisted(() => {
  return {
    useConfirmMock: vi.fn<() => Promise<boolean | null>>(async () => true),
    fetchMock: vi.fn(),
  }
})

mockNuxtImport('useConfirm', () => {
  return useConfirmMock
})

mockNuxtImport('$fetch', () => {
  return fetchMock
})

enableAutoUnmount(afterEach)

function resetChatShareState() {
  const {
    closeShareModal,
    isLoading,
    isSaving,
    isBranching,
  } = useChatShare()

  closeShareModal()
  isLoading.value = false
  isSaving.value = false
  isBranching.value = false
}

describe('Chat/ShareModal.client', () => {
  beforeEach(() => {
    resetChatShareState()
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(() => {})
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(() => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })

    const { targetChatSlug } = useChatShare()

    targetChatSlug.value = 'chat-1'
  })

  afterEach(() => {
    resetChatShareState()
    vi.unstubAllGlobals()
  })

  it('shows the file warning when the chat has files and files are shown', async () => {
    const { targetHasFiles } = useChatShare()

    targetHasFiles.value = true

    const wrapper = await mountSuspended(ShareModal)

    expect(wrapper.find('[data-testid="share-files-warning"]').exists())
      .toBe(true)
  })

  it('hides the file warning when the chat has no files', async () => {
    const { targetHasFiles } = useChatShare()

    targetHasFiles.value = false

    const wrapper = await mountSuspended(ShareModal)

    expect(wrapper.find('[data-testid="share-files-warning"]').exists())
      .toBe(false)
  })

  it('hides the file warning once the show-files toggle is switched off', async () => {
    const { targetHasFiles } = useChatShare()

    targetHasFiles.value = true

    const wrapper = await mountSuspended(ShareModal)

    expect(wrapper.find('[data-testid="share-files-warning"]').exists())
      .toBe(true)

    await wrapper.find('[data-testid="share-toggle-files"]')
      .setValue(false)

    expect(wrapper.find('[data-testid="share-files-warning"]').exists())
      .toBe(false)
  })

  it.each([true, false])('warns that replies may restate memory '
    + '(chat has files: %s)', async (hasFiles) => {
    const { targetHasFiles } = useChatShare()

    targetHasFiles.value = hasFiles

    const wrapper = await mountSuspended(ShareModal)
    const warning = wrapper.find('[data-testid="share-memory-warning"]')

    expect(warning.exists()).toBe(true)
    expect(warning.text().replace(/\s+/g, ' ')).toBe(
      'Replies may restate your saved profile and preferences from memory. '
      + 'Anyone with the link can read them.',
    )
  })

  it('defaults the author avatar toggle to on', async () => {
    const wrapper = await mountSuspended(ShareModal)

    const authorToggle = wrapper.find('[data-testid="share-toggle-author"]')

    expect((authorToggle.element as HTMLInputElement).checked).toBe(true)
  })

  it('defaults the allow branch toggle to on', async () => {
    const wrapper = await mountSuspended(ShareModal)

    const branchToggle = wrapper.find('[data-testid="share-toggle-branch"]')

    expect((branchToggle.element as HTMLInputElement).checked).toBe(true)
  })

  it('labels the metadata toggle "Show message details"', async () => {
    const wrapper = await mountSuspended(ShareModal)

    const toggleInput = wrapper.find('[data-testid="share-toggle-metadata"]')
    const toggleRow = toggleInput.element.closest('label')

    expect(toggleRow?.querySelector('span')?.textContent?.trim())
      .toBe('Show message details')
  })

  it('renders each toggle row with the label before the toggle', async () => {
    const wrapper = await mountSuspended(ShareModal)

    const toggleTestIds = [
      'share-toggle-indexable',
      'share-toggle-files',
      'share-toggle-metadata',
      'share-toggle-author',
      'share-toggle-branch',
    ]

    toggleTestIds.forEach((testId) => {
      const toggleInput = wrapper.find(`[data-testid="${testId}"]`)
      const toggleRow = toggleInput.element.closest('label')

      expect(toggleRow?.firstElementChild?.tagName).toBe('SPAN')
      expect(toggleRow?.lastElementChild?.tagName).toBe('INPUT')
    })
  })

  it('renders 1 hour as the first duration option', async () => {
    const wrapper = await mountSuspended(ShareModal)

    const options = wrapper.findAll(
      '[data-testid="share-duration-select"] option',
    )

    expect(options[0]?.attributes('value')).toBe('hour')
    expect(options[0]?.text()).toBe('1 hour')
  })

  it('infers the hour duration when the share expires soon', async () => {
    const { share } = useChatShare()

    share.value = {
      slug: 'share-1',
      url: 'http://localhost:3000/shared/share-1',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      indexable: true,
      showFiles: true,
      showMetadata: true,
      showAuthorAvatar: true,
      allowBranch: true,
    }

    const wrapper = await mountSuspended(ShareModal)

    const select = wrapper.find('[data-testid="share-duration-select"]')

    expect((select.element as HTMLSelectElement).value).toBe('hour')
  })

  it('generates a share link, auto-copies it, and shows the Copied state', async () => {
    fetchMock.mockResolvedValue({
      slug: 'share-1',
      url: 'https://old-preview-host.example/shared/share-1',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
      showAuthorAvatar: true,
      allowBranch: true,
    })

    const wrapper = await mountSuspended(ShareModal)

    await wrapper.find('[data-testid="share-generate-button"]')
      .trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/chat-1/share', {
      method: 'POST',
      body: {
        duration: 'never',
        indexable: true,
        showFiles: true,
        showMetadata: true,
        showAuthorAvatar: true,
        allowBranch: true,
      },
    })

    const linkInput = wrapper.find('[data-testid="share-link-input"]')

    expect(linkInput.exists()).toBe(true)
    expect((linkInput.element as HTMLInputElement).value).toBe(
      'http://localhost:3000/shared/share-1',
    )

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'http://localhost:3000/shared/share-1',
    )

    const copyButton = wrapper.find('[data-testid="share-copy-button"]')

    expect(copyButton.text()).toContain('Copied!')
  })

  it('does not show an error when auto-copy fails after generating', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
    })

    fetchMock.mockResolvedValue({
      slug: 'share-1',
      url: 'https://old-preview-host.example/shared/share-1',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
      showAuthorAvatar: true,
      allowBranch: true,
    })

    const wrapper = await mountSuspended(ShareModal)

    await wrapper.find('[data-testid="share-generate-button"]')
      .trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'http://localhost:3000/shared/share-1',
    )
    expect(useErrorMessage).not.toHaveBeenCalled()
  })

  it('shows an error when the explicit copy button fails', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
    })

    const { share } = useChatShare()

    share.value = {
      slug: 'share-1',
      url: 'http://localhost:3000/shared/share-1',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
      showAuthorAvatar: true,
      allowBranch: true,
    }

    const wrapper = await mountSuspended(ShareModal)

    await wrapper.find('[data-testid="share-copy-button"]')
      .trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(useErrorMessage).toHaveBeenCalledWith('Failed to copy link')
  })

  it('copies the share link to the clipboard on demand', async () => {
    const { share } = useChatShare()

    share.value = {
      slug: 'share-1',
      url: 'http://localhost:3000/shared/share-1',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
      showAuthorAvatar: true,
      allowBranch: true,
    }

    const wrapper = await mountSuspended(ShareModal)

    expect(wrapper.find('[data-testid="share-copy-button"]').text())
      .toContain('Copy')

    await wrapper.find('[data-testid="share-copy-button"]')
      .trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'http://localhost:3000/shared/share-1',
    )
    expect(wrapper.find('[data-testid="share-copy-button"]').text())
      .toContain('Copied!')
  })

  it('stops sharing and removes the active share', async () => {
    useConfirmMock.mockResolvedValue(true)
    fetchMock.mockResolvedValue(undefined)

    const { share } = useChatShare()

    share.value = {
      slug: 'share-1',
      url: 'http://localhost:3000/shared/share-1',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
      showAuthorAvatar: true,
      allowBranch: true,
    }

    const wrapper = await mountSuspended(ShareModal)

    await wrapper.find('[data-testid="share-revoke-button"]')
      .trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/chats/chat-1/share/revoke',
      { method: 'POST' },
    )
    expect(share.value).toBeNull()
    expect(wrapper.find('[data-testid="share-revoke-button"]').exists())
      .toBe(false)
  })

  it('does not stop sharing when confirmation is declined', async () => {
    useConfirmMock.mockResolvedValue(null)
    fetchMock.mockResolvedValue(undefined)

    const { share } = useChatShare()

    share.value = {
      slug: 'share-1',
      url: 'http://localhost:3000/shared/share-1',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
      showAuthorAvatar: true,
      allowBranch: true,
    }

    const wrapper = await mountSuspended(ShareModal)

    await wrapper.find('[data-testid="share-revoke-button"]')
      .trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(share.value).not.toBeNull()
  })

  it('disables the submit buttons while loading share settings', async () => {
    const { isLoading } = useChatShare()

    isLoading.value = true

    const wrapper = await mountSuspended(ShareModal)

    expect(
      wrapper.find('[data-testid="share-form-skeleton"]').exists(),
    ).toBe(true)
    expect(
      (
        wrapper.find('[data-testid="share-generate-button"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('resets stale toggle state when the target chat changes', async () => {
    const wrapper = await mountSuspended(ShareModal)

    await wrapper.find('[data-testid="share-toggle-indexable"]')
      .setValue(false)

    expect(
      (
        wrapper.find('[data-testid="share-toggle-indexable"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(false)

    const { targetChatSlug } = useChatShare()

    targetChatSlug.value = 'chat-2'
    await wrapper.vm.$nextTick()

    expect(
      (
        wrapper.find('[data-testid="share-toggle-indexable"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(true)
  })

  describe('personal-data check', () => {
    const emailAndPhone: SharePiiCheckResult = {
      warnings: [
        { kind: 'email', source: 'detector' },
        { kind: 'phone', source: 'detector' },
      ],
      checked: true,
    }

    function setCheck(
      status: 'pending' | 'done' | 'error',
      result: SharePiiCheckResult | null = null,
    ) {
      const { shareCheck } = useChatShare()

      shareCheck.value = { status, result }
    }

    function normalized(text: string): string {
      return text.replace(/\s+/g, ' ').trim()
    }

    async function settleTimers(milliseconds = JEV_SHARE_CHECK_DEBOUNCE_MS) {
      await vi.advanceTimersByTimeAsync(milliseconds)
    }

    afterEach(() => {
      vi.useRealTimers()
    })

    it('reserves the slot with a skeleton before a check has started',
      async () => {
        const wrapper = await mountSuspended(ShareModal)

        expect(wrapper.find('[data-testid="share-pii-skeleton"]').exists())
          .toBe(true)
      })

    it('keeps the previous result on screen while a re-check is pending',
      async () => {
        const wrapper = await mountSuspended(ShareModal)
        const { shareCheck } = useChatShare()

        shareCheck.value = { status: 'pending', result: emailAndPhone }
        await wrapper.vm.$nextTick()

        expect(wrapper.find('[data-testid="share-pii-warning"]').exists())
          .toBe(true)
        expect(wrapper.find('[data-testid="share-pii-skeleton"]').exists())
          .toBe(false)
      })

    it('shows a skeleton of the same height while the check runs', async () => {
      setCheck('pending')

      const wrapper = await mountSuspended(ShareModal)
      const skeleton = wrapper.get('[data-testid="share-pii-skeleton"]')

      expect(wrapper.get('[data-testid="share-pii-slot"]').classes())
        .toEqual(expect.arrayContaining(['min-h-36', 'sm:min-h-28']))
      expect(skeleton.classes())
        .toEqual(expect.arrayContaining(['h-36', 'sm:h-28', 'rounded-box']))
      expect(wrapper.find('[data-testid="share-pii-warning"]').exists())
        .toBe(false)
    })

    it('warns with the found kinds, the link audience and the user\'s own '
      + 'details', async () => {
      setCheck('done', emailAndPhone)

      const wrapper = await mountSuspended(ShareModal)
      const warning = wrapper.get('[data-testid="share-pii-warning"]')

      expect(warning.attributes('role')).toBe('alert')
      expect(warning.classes())
        .toEqual(expect.arrayContaining(['min-h-36', 'sm:min-h-28']))
      expect(normalized(warning.text())).toContain(
        'This chat may contain personal data (email, phone). Anyone with '
        + 'the link can read it. Your own contact details count too.',
      )
      expect(wrapper.find('[data-testid="share-pii-skeleton"]').exists())
        .toBe(false)
    })

    it('names the AI-only finding as personal details', async () => {
      setCheck('done', {
        warnings: [{ kind: 'personal-data', source: 'typesafe' }],
        checked: true,
      })

      const wrapper = await mountSuspended(ShareModal)

      expect(normalized(
        wrapper.get('[data-testid="share-pii-warning"]').text(),
      )).toContain('personal data (personal details).')
    })

    it('lists at most three kinds and marks the rest with an ellipsis',
      async () => {
        setCheck('done', {
          warnings: [
            { kind: 'email', source: 'detector' },
            { kind: 'phone', source: 'detector' },
            { kind: 'payment-card', source: 'detector' },
            { kind: 'iban', source: 'detector' },
          ],
          checked: false,
        })

        const wrapper = await mountSuspended(ShareModal)

        expect(normalized(
          wrapper.get('[data-testid="share-pii-warning"]').text(),
        )).toContain('personal data (email, phone, card number…).')
      })

    it('stresses search engines only while indexing is on', async () => {
      setCheck('done', emailAndPhone)

      const wrapper = await mountSuspended(ShareModal)

      expect(wrapper.get('[data-testid="share-pii-indexable"]').text())
        .toBe('It can also appear in search engines.')

      await wrapper.find('[data-testid="share-toggle-indexable"]')
        .setValue(false)

      expect(wrapper.find('[data-testid="share-pii-indexable"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="share-pii-warning"]').exists())
        .toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('confirms quietly when the AI check found nothing', async () => {
      setCheck('done', { warnings: [], checked: true })

      const wrapper = await mountSuspended(ShareModal)
      const clear = wrapper.get('[data-testid="share-pii-clear"]')

      expect(clear.classes())
        .toEqual(expect.arrayContaining(['min-h-36', 'sm:min-h-28']))
      expect(clear.text()).toContain('No personal data found')
      expect(wrapper.find('[data-testid="share-pii-warning"]').exists())
        .toBe(false)
    })

    it('shows the generic reminder when the check could not finish and found '
      + 'nothing', async () => {
      setCheck('done', { warnings: [], checked: false })

      const wrapper = await mountSuspended(ShareModal)
      const reminder = wrapper.get('[data-testid="share-pii-reminder"]')

      expect(reminder.classes())
        .toEqual(expect.arrayContaining(['min-h-36', 'sm:min-h-28']))
      expect(normalized(reminder.text())).toContain(
        'Check the chat for personal data before sharing.',
      )
      expect(wrapper.find('[data-testid="share-pii-clear"]').exists())
        .toBe(false)
    })

    it('shows the generic reminder when the request failed', async () => {
      setCheck('error')

      const wrapper = await mountSuspended(ShareModal)

      expect(normalized(
        wrapper.get('[data-testid="share-pii-reminder"]').text(),
      )).toContain('Check the chat for personal data before sharing.')
    })

    it('also stresses search engines in the generic reminder', async () => {
      setCheck('error')

      const wrapper = await mountSuspended(ShareModal)

      expect(wrapper.find('[data-testid="share-pii-indexable"]').exists())
        .toBe(true)
    })

    it.each([
      ['pending', null],
      ['done', emailAndPhone],
      ['error', null],
    ] as const)('never blocks Generate while the check is %s',
      async (status, result) => {
        setCheck(status, result)
        fetchMock.mockResolvedValue({
          slug: 'share-1',
          url: 'http://localhost:3000/shared/share-1',
          expiresAt: null,
          indexable: true,
          showFiles: true,
          showMetadata: true,
          showAuthorAvatar: true,
          allowBranch: true,
        })

        const wrapper = await mountSuspended(ShareModal)
        const generate = wrapper.get('[data-testid="share-generate-button"]')

        expect((generate.element as HTMLButtonElement).disabled).toBe(false)

        await generate.trigger('click')
        await new Promise(resolve => setTimeout(resolve))

        expect(fetchMock).toHaveBeenCalledWith(
          '/api/v1/chats/chat-1/share',
          expect.objectContaining({ method: 'POST' }),
        )
      })

    it('checks once after the modal opens, debounced, with the current '
      + 'options', async () => {
      fetchMock.mockResolvedValue({ warnings: [], checked: true })

      const wrapper = await mountSuspended(ShareModal)

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const { isModalOpen, shareCheck } = useChatShare()

      isModalOpen.value = true
      await wrapper.vm.$nextTick()

      expect(shareCheck.value.status).toBe('pending')
      expect(fetchMock).not.toHaveBeenCalled()

      await settleTimers()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/chats/chat-1/share/check',
        expect.objectContaining({
          method: 'POST',
          body: { showFiles: true, showMetadata: true },
        }),
      )
      expect(shareCheck.value).toEqual({
        status: 'done',
        result: { warnings: [], checked: true },
      })
    })

    it('does not check while the share settings are still loading',
      async () => {
        const wrapper = await mountSuspended(ShareModal)

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const { isModalOpen, isLoading } = useChatShare()

        isLoading.value = true
        isModalOpen.value = true
        await wrapper.vm.$nextTick()
        await settleTimers()

        expect(fetchMock).not.toHaveBeenCalled()

        fetchMock.mockResolvedValue({ warnings: [], checked: true })
        isLoading.value = false
        await wrapper.vm.$nextTick()
        await settleTimers()

        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

    it('re-checks, debounced, when files are toggled and not when message '
      + 'details are', async () => {
      fetchMock.mockResolvedValue({ warnings: [], checked: true })

      const wrapper = await mountSuspended(ShareModal)

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const { isModalOpen } = useChatShare()

      isModalOpen.value = true
      await wrapper.vm.$nextTick()
      await settleTimers()

      expect(fetchMock).toHaveBeenCalledTimes(1)

      await wrapper.find('[data-testid="share-toggle-files"]')
        .setValue(false)
      await wrapper.find('[data-testid="share-toggle-files"]')
        .setValue(true)
      await wrapper.find('[data-testid="share-toggle-files"]')
        .setValue(false)
      await settleTimers()

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/v1/chats/chat-1/share/check',
        expect.objectContaining({
          body: { showFiles: false, showMetadata: true },
        }),
      )

      await wrapper.find('[data-testid="share-toggle-metadata"]')
        .setValue(false)
      await settleTimers()

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('shows the generic reminder without an error toast when the check '
      + 'request fails', async () => {
      const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

      fetchMock.mockRejectedValue(new Error('429'))

      const wrapper = await mountSuspended(ShareModal)

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const { isModalOpen, shareCheck } = useChatShare()

      isModalOpen.value = true
      await wrapper.vm.$nextTick()
      await settleTimers()
      await wrapper.vm.$nextTick()

      expect(shareCheck.value.status).toBe('error')
      expect(wrapper.find('[data-testid="share-pii-reminder"]').exists())
        .toBe(true)
      expect(useErrorMessage).not.toHaveBeenCalled()
    })

    it('treats a response without a warnings list as a failed check',
      async () => {
        fetchMock.mockResolvedValue({ slug: 'unrelated' })

        const wrapper = await mountSuspended(ShareModal)

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const { isModalOpen, shareCheck } = useChatShare()

        isModalOpen.value = true
        await wrapper.vm.$nextTick()
        await settleTimers()

        expect(shareCheck.value.status).toBe('error')
      })

    it('keeps Generate clickable while a slow check is still pending',
      async () => {
        fetchMock.mockImplementation(async (url: string) => {
          if (url.endsWith('/share/check')) {
            return await new Promise(() => {})
          }

          return {
            slug: 'share-1',
            url: 'http://localhost:3000/shared/share-1',
            expiresAt: null,
            indexable: true,
            showFiles: true,
            showMetadata: true,
            showAuthorAvatar: true,
            allowBranch: true,
          }
        })

        const wrapper = await mountSuspended(ShareModal)

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

        const { isModalOpen, shareCheck } = useChatShare()

        isModalOpen.value = true
        await wrapper.vm.$nextTick()
        await settleTimers()

        expect(shareCheck.value.status).toBe('pending')

        const generate = wrapper.get('[data-testid="share-generate-button"]')

        expect((generate.element as HTMLButtonElement).disabled).toBe(false)

        await generate.trigger('click')
        await vi.advanceTimersByTimeAsync(0)

        expect(fetchMock).toHaveBeenCalledWith(
          '/api/v1/chats/chat-1/share',
          expect.objectContaining({ method: 'POST' }),
        )
      })

    it('resets the check when the modal closes', async () => {
      setCheck('done', emailAndPhone)

      const { closeShareModal, shareCheck } = useChatShare()

      closeShareModal()

      expect(shareCheck.value).toEqual({ status: 'idle', result: null })
    })
  })
})
