import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import DriveImportNote from '../../../../../../app/components/ChatInput/Files/Attached/DriveImportNote.vue'

describe('ChatInput/Files/Attached/DriveImportNote', () => {
  it('shows the sentence with the technical code after it in small text',
    async () => {
      const wrapper = await mountSuspended(DriveImportNote, {
        props: {
          id: 'note-d1',
          item: {
            id: 'd1',
            name: 'Plan',
            status: 'failed',
            error: 'Besidka cannot see this file.',
            code: 'not_found',
            detail: 'Google: notFound, metadata',
          },
        },
      })
      const note = wrapper.get('[data-testid="drive-import-note"]')

      expect(note.attributes('id')).toBe('note-d1')
      expect(note.attributes('role')).toBe('region')
      expect(note.attributes('aria-label'))
        .toBe('Why Plan could not be imported')
      expect(wrapper.get('[data-testid="drive-import-note-text"]').text())
        .toBe('Besidka cannot see this file.')
      expect(wrapper.get('[data-testid="drive-import-note-detail"]').text())
        .toBe('(Google: notFound, metadata)')
    })

  it('offers Pick again and Remove, and says so with events', async () => {
    const wrapper = await mountSuspended(DriveImportNote, {
      props: {
        id: 'note-d1',
        item: {
          id: 'd1',
          name: 'Plan',
          status: 'failed',
          error: 'Nope.',
          code: 'no_access',
        },
      },
    })

    await wrapper.get('[data-testid="drive-import-pick-again"]')
      .trigger('click')
    await wrapper.get('[data-testid="drive-import-remove"]').trigger('click')

    expect(wrapper.emitted('pick-again')).toHaveLength(1)
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('has no Pick again for a failure that picking again cannot fix',
    async () => {
      const wrapper = await mountSuspended(DriveImportNote, {
        props: {
          id: 'note-d1',
          item: {
            id: 'd1',
            name: 'Plan',
            status: 'failed',
            error: 'Too large.',
            code: 'too_large',
          },
        },
      })

      expect(wrapper.find('[data-testid="drive-import-pick-again"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="drive-import-note-detail"]').exists())
        .toBe(false)
    })

  it('falls back to a plain sentence when there is none', async () => {
    const wrapper = await mountSuspended(DriveImportNote, {
      props: {
        id: 'note-d1',
        item: { id: 'd1', name: 'Plan', status: 'failed' },
      },
    })

    expect(wrapper.get('[data-testid="drive-import-note-text"]').text())
      .toBe('This file could not be imported.')
  })
})
