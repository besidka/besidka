import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SaveToGoogleDrive from '../../../../app/components/Chat/SaveToGoogleDrive.vue'

type SavedState = null | { link: string, driveFileId: string }

const mocks = vi.hoisted(() => ({
  isAvailable: true,
  savedRef: null as unknown as { value: SavedState },
  save: vi.fn(),
}))

mockNuxtImport('useGoogleDriveSave', async () => {
  const { computed, shallowRef } = await import('vue')

  mocks.savedRef = shallowRef<SavedState>(null)

  return () => ({
    isAvailable: computed(() => mocks.isAvailable),
    getSaved: () => mocks.savedRef.value,
    save: mocks.save,
  })
})

const LINK = 'https://drive.google.com/open?id=1NewDriveNewDriveNewDriveNew99'

async function mountButton(props: Record<string, unknown> = {}) {
  return await mountSuspended(SaveToGoogleDrive, {
    props: { storageKey: 'key-1', fileName: 'Report.md', ...props },
  })
}

describe('Chat/SaveToGoogleDrive', () => {
  beforeEach(() => {
    mocks.isAvailable = true
    mocks.savedRef.value = null
    mocks.save.mockReset()
  })

  it('renders nothing while Google Drive is not connected', async () => {
    mocks.isAvailable = false

    const wrapper = await mountButton()

    expect(wrapper.find('[data-testid="save-to-google-drive"]').exists())
      .toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('offers "Save to Google Drive" as an icon button with its name',
    async () => {
      const wrapper = await mountButton()
      const button = wrapper.get('[data-testid="save-to-google-drive"]')

      expect(button.attributes('aria-label'))
        .toBe('Save Report.md to Google Drive')
      expect(button.attributes('title')).toBe('Save to Google Drive')
      expect(button.text()).toBe('')
    })

  it('shows the label in the button variant', async () => {
    const wrapper = await mountButton({ variant: 'button' })

    expect(wrapper.get('[data-testid="save-to-google-drive"]').text())
      .toBe('Save to Google Drive')
  })

  it('saves one file per click and shows progress while it runs',
    async () => {
      let finish: (value: unknown) => void = () => {}

      mocks.save.mockReturnValueOnce(new Promise((resolve) => {
        finish = resolve
      }))

      const wrapper = await mountButton({ variant: 'button' })
      const button = wrapper.get('[data-testid="save-to-google-drive"]')

      await button.trigger('click')
      await button.trigger('click')

      expect(mocks.save).toHaveBeenCalledTimes(1)
      expect(mocks.save).toHaveBeenCalledWith('key-1')
      expect(button.attributes('disabled')).toBeDefined()
      expect(button.attributes('aria-busy')).toBe('true')
      expect(button.text()).toBe('Saving to Google Drive')

      finish(null)
      await vi.waitFor(() => {
        expect(button.attributes('disabled')).toBeUndefined()
      })
    })

  it('announces the result in a live region, for a save and a failure',
    async () => {
      mocks.save.mockResolvedValueOnce({ link: LINK, driveFileId: 'd1' })

      const wrapper = await mountButton()
      const status = wrapper.get('[data-testid="save-to-google-drive-status"]')

      expect(status.attributes('role')).toBe('status')
      expect(status.attributes('aria-live')).toBe('polite')

      await wrapper.get('[data-testid="save-to-google-drive"]')
        .trigger('click')
      await vi.waitFor(() => {
        expect(status.text()).toBe('Report.md was saved to Google Drive')
      })

      mocks.save.mockResolvedValueOnce(null)

      const failing = await mountButton()
      const failingStatus = failing.get(
        '[data-testid="save-to-google-drive-status"]',
      )

      await failing.get('[data-testid="save-to-google-drive"]')
        .trigger('click')
      await vi.waitFor(() => {
        expect(failingStatus.text())
          .toBe('Report.md could not be saved to Google Drive')
      })
    })

  it('keeps focus on the same spot when the button turns into the link',
    async () => {
      const wrapper = await mountSuspended(SaveToGoogleDrive, {
        props: { storageKey: 'key-1', fileName: 'Report.md' },
        attachTo: document.body,
      })
      const button = wrapper.get('[data-testid="save-to-google-drive"]')

      mocks.save.mockImplementationOnce(async () => {
        mocks.savedRef.value = { link: LINK, driveFileId: 'd1' }

        return mocks.savedRef.value
      })
      ;(button.element as HTMLElement).focus()
      await button.trigger('click')
      await vi.waitFor(() => {
        expect(document.activeElement?.getAttribute('data-testid'))
          .toBe('save-to-google-drive-open')
      })

      wrapper.unmount()
    })

  it('shows Open in Google Drive once the file is saved', async () => {
    mocks.savedRef.value = { link: LINK, driveFileId: 'drive-1' }

    const wrapper = await mountButton({ variant: 'button' })
    const link = wrapper.get('[data-testid="save-to-google-drive-open"]')

    expect(link.attributes('href')).toBe(LINK)
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(link.text()).toBe('Open in Google Drive')
    expect(wrapper.find('[data-testid="save-to-google-drive"]').exists())
      .toBe(false)
  })
})
