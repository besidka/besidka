import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useResearchLink } from '../../../app/composables/research-links'
import { useUserSetting } from '../../../app/composables/user-setting'

const useConfirmMock = vi.hoisted(() => {
  return vi.fn<() => Promise<{ label: string, index: number } | null>>(
    async () => null,
  )
})

mockNuxtImport('useConfirm', () => {
  return useConfirmMock
})

describe('useResearchLink', () => {
  beforeEach(() => {
    localStorage.clear()
    useConfirmMock.mockReset().mockResolvedValue(null)

    const { clearUserContext } = useUserSetting()

    clearUserContext()
  })

  it('opens the URL when the confirm dialog is accepted', async () => {
    useConfirmMock.mockResolvedValue({ label: 'Open', index: 0 })

    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)

    const { openResearchLink } = useResearchLink()

    await openResearchLink('https://example.com/research/crdt')

    expect(useConfirmMock).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Open example.com?',
    }))
    expect(windowOpen).toHaveBeenCalledWith(
      'https://example.com/research/crdt',
      '_blank',
      'noopener,noreferrer',
    )

    windowOpen.mockRestore()
  })

  it('does not open the URL when the confirm dialog is declined', async () => {
    useConfirmMock.mockResolvedValue(null)

    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)

    const { openResearchLink } = useResearchLink()

    await openResearchLink('https://example.com/research/crdt')

    expect(windowOpen).not.toHaveBeenCalled()

    windowOpen.mockRestore()
  })

  it('persists "Open always" via setAllowExternalLinks and still opens', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ allowExternalLinks: false })
      .mockResolvedValueOnce({})

    vi.stubGlobal('$fetch', fetchMock)

    const { syncForUser } = useUserSetting()

    await syncForUser('user-1')

    useConfirmMock
      .mockResolvedValueOnce({ label: 'Open always', index: 1 })
      .mockResolvedValueOnce({ label: 'Yes, always', index: 0 })

    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)

    const { openResearchLink } = useResearchLink()

    await openResearchLink('https://example.com/research/crdt')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/profiles/settings',
      {
        method: 'PATCH',
        body: {
          allowExternalLinks: true,
        },
      },
    )
    expect(windowOpen).toHaveBeenCalledWith(
      'https://example.com/research/crdt',
      '_blank',
      'noopener,noreferrer',
    )

    windowOpen.mockRestore()
    vi.unstubAllGlobals()
  })

  it('opens without a prompt when allowExternalLinks is already true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ allowExternalLinks: true })

    vi.stubGlobal('$fetch', fetchMock)

    const { syncForUser, allowExternalLinks } = useUserSetting()

    await syncForUser('user-1')

    expect(allowExternalLinks.value).toBe(true)

    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)

    const { openResearchLink } = useResearchLink()

    await openResearchLink('https://example.com/research/crdt')

    expect(useConfirmMock).not.toHaveBeenCalled()
    expect(windowOpen).toHaveBeenCalledWith(
      'https://example.com/research/crdt',
      '_blank',
      'noopener,noreferrer',
    )

    windowOpen.mockRestore()
    vi.unstubAllGlobals()
  })
})
