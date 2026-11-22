import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SaveToGoogleDrive from '../../../../app/components/Chat/SaveToGoogleDrive.vue'

const mocks = vi.hoisted(() => ({
  isAvailable: true,
  saved: null as null | { link: string, driveFileId: string },
  save: vi.fn(),
}))

mockNuxtImport('useGoogleDriveSave', async () => {
  const { computed } = await import('vue')

  return () => ({
    isAvailable: computed(() => mocks.isAvailable),
    getSaved: () => mocks.saved,
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
    mocks.saved = null
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

  it('shows Open in Google Drive once the file is saved', async () => {
    mocks.saved = { link: LINK, driveFileId: 'drive-1' }

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
