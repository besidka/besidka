import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { ChatInputTile } from '../../../../../../app/types/chat-input-tools'
import { OFFICE_MEDIA_TYPES } from '../../../../../../shared/utils/office-files'
import { createFileDeliveryResolver } from '../../../../../../app/utils/file-delivery-hints'
import Preview from '../../../../../../app/components/ChatInput/Files/Attached/Preview.client.vue'

function createTile(overrides: Partial<ChatInputTile>): ChatInputTile {
  return {
    id: 'search',
    section: 'search',
    icon: { kind: 'icon', name: 'lucide:globe' },
    caption: 'Web search',
    value: 'Built-in',
    chipLabel: 'Search: Built-in',
    ariaLabel: 'Web search: Built-in',
    removeLabel: 'Turn off web search',
    isNeutral: false,
    isAuto: false,
    isLocked: false,
    isDisabled: false,
    ...overrides,
  }
}

const files = [
  { storageKey: 'a', name: 'a.png', type: 'image/png', size: 1 },
  { storageKey: 'b', name: 'b.png', type: 'image/png', size: 1 },
]

describe('ChatInput/Files/Attached/Preview', () => {
  it('renders nothing without tiles or files', async () => {
    const wrapper = await mountSuspended(Preview, {
      props: { files: [], tiles: [] },
    })

    expect(wrapper.find('[role="region"]').exists()).toBe(false)
  })

  it('renders tiles alone when there are no files', async () => {
    const wrapper = await mountSuspended(Preview, {
      props: { files: [], tiles: [createTile({})] },
    })

    expect(wrapper.get('[role="region"]').attributes('aria-label'))
      .toBe('Active settings')
    expect(wrapper.find('[data-testid="chat-input-tile-search"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="carousel-item"]').exists()).toBe(false)
  })

  it('puts tiles before files and counts only files in Detach all',
    async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files,
          tiles: [
            createTile({ id: 'project', section: 'project' }),
            createTile({}),
          ],
        },
      })
      const items = wrapper.findAll('.carousel > *')

      expect(items[0]?.attributes('data-testid'))
        .toBe('chat-input-tile-project')
      expect(items[1]?.attributes('data-testid'))
        .toBe('chat-input-tile-search')
      expect(items[2]?.attributes('data-testid')).toBe('carousel-item')
      expect(wrapper.get('[data-testid="files-preview-detach-all"]').text())
        .toContain('2')
      expect(wrapper.get('[role="region"]').attributes('aria-label'))
        .toBe('Active settings and files')
    })

  it('re-emits tile open and remove events', async () => {
    const wrapper = await mountSuspended(Preview, {
      props: { files: [], tiles: [createTile({})] },
    })

    await wrapper.get('[data-testid="chat-input-tile-search-body"]')
      .trigger('click')
    await wrapper.get('[data-testid="chat-input-tile-search-remove"]')
      .trigger('click')

    expect(wrapper.emitted('open-tile')?.[0]?.[0]).toBe('search')
    expect(wrapper.emitted('remove-tile')).toEqual([['search']])
  })

  it('renders tiles as pills while there are no files', async () => {
    const wrapper = await mountSuspended(Preview, {
      props: { files: [], tiles: [createTile({})] },
    })

    expect(
      wrapper.get('[data-testid="chat-input-tile-search-body"]')
        .attributes('data-variant'),
    ).toBe('pill')
  })

  it('renders tiles as pills when only a completed upload is listed',
    async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [],
          tiles: [createTile({})],
          uploadingFiles: new Map([[
            'u1',
            {
              id: 'u1',
              file: new File(['x'], 'x.png', { type: 'image/png' }),
              progress: 100,
              status: 'completed',
            },
          ]]) as never,
        },
      })

      expect(
        wrapper.get('[data-testid="chat-input-tile-search-body"]')
          .attributes('data-variant'),
      ).toBe('pill')
    })

  it('switches every tile to the square size once a file is attached',
    async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [files[0]!],
          tiles: [
            createTile({ id: 'project', section: 'project' }),
            createTile({}),
          ],
        },
      })

      expect(
        wrapper.get('[data-testid="chat-input-tile-project-body"]')
          .attributes('data-variant'),
      ).toBe('square')
      expect(
        wrapper.get('[data-testid="chat-input-tile-search-body"]')
          .attributes('data-variant'),
      ).toBe('square')
    })

  it('switches back to pills when the last file is removed', async () => {
    const wrapper = await mountSuspended(Preview, {
      props: { files: [files[0]!], tiles: [createTile({})] },
    })

    await wrapper.setProps({ files: [] })

    expect(
      wrapper.get('[data-testid="chat-input-tile-search-body"]')
        .attributes('data-variant'),
    ).toBe('pill')
  })

  it('renders pasted texts as text chips before the files', async () => {
    const wrapper = await mountSuspended(Preview, {
      props: {
        files,
        pastedTexts: [
          { id: 'pasted-1', content: 'Hello\nWorld\nThird\nFourth' },
        ],
      },
    })

    const item = wrapper.get('[data-testid="pasted-text-item"]')
    const carousel = wrapper.get('.carousel')

    expect(carousel.element.firstElementChild).toBe(item.element)
    expect(item.findAll('[data-testid="files-preview-text-lines"] p')
      .map(line => line.text())).toEqual(['Hello', 'World', 'Third'])
    expect(item.get('[data-testid="files-preview-text-meta"]').text())
      .toBe('4 lines, 24 B')
    expect(wrapper.get('[data-testid="files-preview-detach-all"]').text())
      .toContain('2')
  })

  it('renders a pasted text alone as an attachment region', async () => {
    const wrapper = await mountSuspended(Preview, {
      props: {
        files: [],
        tiles: [createTile({})],
        pastedTexts: [{ id: 'pasted-1', content: 'Body' }],
      },
    })

    expect(wrapper.find('[role="region"]').exists()).toBe(true)
    expect(
      wrapper.get('[data-testid="chat-input-tile-search-body"]')
        .attributes('data-variant'),
    ).toBe('square')
  })

  it('labels a pasted text chip as a group', async () => {
    const wrapper = await mountSuspended(Preview, {
      props: {
        files: [],
        pastedTexts: [{ id: 'pasted-1', content: 'Body' }],
      },
    })

    const item = wrapper.get('[data-testid="pasted-text-item"]')

    expect(item.attributes('role')).toBe('group')
    expect(item.attributes('aria-label')).toBe('Pasted text')
  })

  it('names the region after what it holds', async () => {
    const pastedTexts = [
      { id: 'pasted-1', content: 'One' },
      { id: 'pasted-2', content: 'Two' },
    ]
    const regionLabel = async (props: Record<string, unknown>) => {
      const wrapper = await mountSuspended(Preview, { props })

      return wrapper.get('[role="region"]').attributes('aria-label')
    }

    expect(await regionLabel({ files: [], pastedTexts: [pastedTexts[0]] }))
      .toBe('Pasted text')
    expect(await regionLabel({ files: [], pastedTexts }))
      .toBe('Pasted texts')
    expect(await regionLabel({ files, pastedTexts }))
      .toBe('Files and pasted text')
    expect(await regionLabel({ files: [files[0]] })).toBe('File')
    expect(await regionLabel({
      files: [],
      tiles: [createTile({})],
      pastedTexts,
    })).toBe('Active settings and pasted texts')
  })

  it('emits open and remove for a pasted text', async () => {
    const wrapper = await mountSuspended(Preview, {
      props: {
        files: [],
        pastedTexts: [{ id: 'pasted-1', content: 'Body' }],
      },
    })

    await wrapper.get('[data-testid="files-preview-text-open"]')
      .trigger('click')
    await wrapper.get('[data-testid="pasted-text-remove"]').trigger('click')

    expect(wrapper.emitted('open-pasted')).toEqual([['pasted-1']])
    expect(wrapper.emitted('remove-pasted')).toEqual([['pasted-1']])
  })

  it('renders an attached text file as a text card that opens it',
    async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [{
            storageKey: 'notes-key',
            name: 'notes.md',
            type: 'text/markdown',
            size: 2 * 1024 * 1024 * 1024,
          }],
        },
      })

      await wrapper.get('[data-testid="files-preview-text-open"]')
        .trigger('click')

      expect(wrapper.emitted('open-text')).toEqual([['notes-key']])
    })

  describe('delivery hint', () => {
    const resolveDelivery = createFileDeliveryResolver({
      route: 'direct',
      providerId: 'anthropic',
      modalities: ['text', 'image', 'pdf'],
    })
    const officeFile = {
      storageKey: 'budget-key',
      name: 'budget.xlsx',
      type: OFFICE_MEDIA_TYPES.xlsx,
      size: 2048,
    }

    it('shows no hint for an Office file whose text is complete',
      async () => {
        const wrapper = await mountSuspended(Preview, {
          props: {
            files: [{
              ...officeFile,
              textStatus: 'ready' as const,
              textOmittedMedia: 0,
              textOmittedCharts: 0,
            }],
            resolveDelivery,
          },
        })

        expect(wrapper.find('[data-testid="files-delivery-hint"]').exists())
          .toBe(false)
      })

    it('shows no hint for an Office file that was not counted yet',
      async () => {
        const wrapper = await mountSuspended(Preview, {
          props: {
            files: [{
              ...officeFile,
              textStatus: 'ready' as const,
              textOmittedMedia: null,
              textOmittedCharts: null,
            }],
            resolveDelivery,
          },
        })

        expect(wrapper.find('[data-testid="files-delivery-hint"]').exists())
          .toBe(false)
      })

    it('names the images that are not sent', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [{
            ...officeFile,
            textStatus: 'ready' as const,
            textOmittedMedia: 1,
          }],
          resolveDelivery,
        },
      })
      const hint = wrapper.get('[data-testid="files-delivery-hint"]')

      expect(hint.text()).toBe('1 image not sent')
      expect(hint.attributes('title')).toBe(
        'The model gets this file\'s text only. Images, charts and formatting aren\'t sent.',
      )
      expect(hint.classes()).toEqual(expect.arrayContaining([
        'badge',
        'badge-soft',
        'badge-xs',
      ]))
    })

    it('names the charts that are not sent', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [{
            ...officeFile,
            textStatus: 'ready' as const,
            textOmittedCharts: 2,
          }],
          resolveDelivery,
        },
      })

      expect(wrapper.get('[data-testid="files-delivery-hint"]').text())
        .toBe('2 charts not sent')
    })

    it('notes a file that was converted from .xls, apart from the hint',
      async () => {
        const wrapper = await mountSuspended(Preview, {
          props: {
            files: [{
              ...officeFile,
              textStatus: 'ready' as const,
              textOmittedMedia: 2,
            }],
            resolveDelivery,
            convertedFromXlsKeys: new Set(['budget-key']),
          },
        })
        const note = wrapper.get('[data-testid="files-converted-note"]')

        expect(note.text()).toBe('Converted from .xls')
        expect(note.attributes('title')).toBe(
          'Converted to .xlsx in your browser before upload. Formulas keep '
          + 'their last calculated values. Styles, charts and macros are not '
          + 'kept.',
        )
        expect(wrapper.get('[data-testid="files-delivery-hint"]').text())
          .toBe('2 images not sent')
      })

    it('shows the converted note alone when nothing is left out', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [{
            ...officeFile,
            textStatus: 'ready' as const,
            textOmittedMedia: 0,
            textOmittedCharts: 0,
          }],
          resolveDelivery,
          convertedFromXlsKeys: new Set(['budget-key']),
        },
      })

      expect(wrapper.get('[data-testid="files-converted-note"]').text())
        .toBe('Converted from .xls')
      expect(wrapper.find('[data-testid="files-delivery-hint"]').exists())
        .toBe(false)
    })

    it('shows no converted note for a file that was not converted',
      async () => {
        const wrapper = await mountSuspended(Preview, {
          props: {
            files: [{ ...officeFile, textStatus: 'ready' as const }],
            resolveDelivery,
            convertedFromXlsKeys: new Set(['another-key']),
          },
        })

        expect(wrapper.find('[data-testid="files-converted-note"]').exists())
          .toBe(false)
      })

    it('says the text is shortened when the file is long', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [{
            ...officeFile,
            textStatus: 'ready' as const,
            textBytes: 300 * 1024,
          }],
          resolveDelivery,
        },
      })

      expect(wrapper.get('[data-testid="files-delivery-hint"]').text())
        .toBe('Shortened')
    })

    it('combines the shortened note with what is not sent', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [{
            ...officeFile,
            textStatus: 'ready' as const,
            textBytes: 300 * 1024,
            textOmittedMedia: 3,
          }],
          resolveDelivery,
        },
      })

      expect(wrapper.get('[data-testid="files-delivery-hint"]').text())
        .toBe('Shortened \u00B7 3 images not sent')
    })

    it('shows no hint for a generated document with no text status yet',
      async () => {
        const wrapper = await mountSuspended(Preview, {
          props: {
            files: [{
              storageKey: 'report-key',
              name: 'report.docx',
              type: OFFICE_MEDIA_TYPES.docx,
              size: 4096,
              textStatus: null,
            }],
            resolveDelivery,
          },
        })

        expect(wrapper.find('[data-testid="files-delivery-hint"]').exists())
          .toBe(false)
      })

    it('shows no hint for images, PDFs and text files', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [
            { storageKey: 'a', name: 'a.png', type: 'image/png', size: 1 },
            { storageKey: 'b', name: 'b.pdf', type: 'application/pdf', size: 1 },
            { storageKey: 'c', name: 'c.txt', type: 'text/plain', size: 1 },
          ],
          resolveDelivery,
        },
      })

      expect(wrapper.find('[data-testid="files-delivery-hint"]').exists())
        .toBe(false)
    })

    it('shows no hint without a resolver', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: { files: [officeFile] },
      })

      expect(wrapper.find('[data-testid="files-delivery-hint"]').exists())
        .toBe(false)
    })
  })
})
