import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import DriveImport from '../../../../../../app/components/ChatInput/Files/Attached/DriveImport.vue'

describe('ChatInput/Files/Attached/DriveImport', () => {
  it('names a failed file and gives its short line a button that controls '
    + 'the note', async () => {
    const wrapper = await mountSuspended(DriveImport, {
      props: {
        item: {
          id: 'd1',
          name: 'Plan',
          status: 'failed',
          error: 'Pick it again.',
        },
        noteId: 'note-d1',
        isNoteOpen: false,
      },
    })
    const line = wrapper.get('[data-testid="drive-import-error"]')

    expect(wrapper.get('[role="group"]').attributes('aria-label'))
      .toBe('Plan could not be attached')
    expect(line.attributes('aria-controls')).toBe('note-d1')
    expect(line.attributes('aria-expanded')).toBe('false')
    expect(line.attributes('aria-label'))
      .toBe('Plan: could not import. Show why')
    expect(line.attributes('title')).toBe('Pick it again.')

    await line.trigger('click')

    expect(wrapper.emitted('toggle-note')).toHaveLength(1)
  })

  it('reports an open note on the button', async () => {
    const wrapper = await mountSuspended(DriveImport, {
      props: {
        item: { id: 'd1', name: 'Plan', status: 'failed' },
        noteId: 'note-d1',
        isNoteOpen: true,
      },
    })

    expect(wrapper.get('[data-testid="drive-import-error"]')
      .attributes('aria-expanded')).toBe('true')
  })

  it('dismisses a failed file from the corner button', async () => {
    const wrapper = await mountSuspended(DriveImport, {
      props: {
        item: { id: 'd1', name: 'Plan', status: 'failed' },
        noteId: 'note-d1',
        isNoteOpen: false,
      },
    })

    await wrapper.get('[data-testid="drive-import-dismiss"]')
      .trigger('click')

    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('shows progress, and no way to dismiss, while copying', async () => {
    const wrapper = await mountSuspended(DriveImport, {
      props: {
        item: { id: 'd1', name: 'Plan', status: 'importing' },
        noteId: 'note-d1',
        isNoteOpen: false,
      },
    })

    expect(wrapper.get('[role="group"]').attributes('aria-label'))
      .toBe('Plan, copying from Google Drive')
    expect(wrapper.find('progress').exists()).toBe(true)
    expect(wrapper.find('[data-testid="drive-import-dismiss"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="drive-import-error"]').exists())
      .toBe(false)
  })
})
