import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
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
      storageKey: 'brief-key',
      name: 'brief.docx',
      type: OFFICE_MEDIA_TYPES.docx,
      size: 2048,
    }
    const spreadsheetFile = {
      storageKey: 'budget-key',
      name: 'budget.xlsx',
      type: OFFICE_MEDIA_TYPES.xlsx,
      size: 2048,
    }

    it('always notes a spreadsheet, with sheets and formulas', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [{
            ...spreadsheetFile,
            textStatus: 'ready' as const,
            textVersion: 2,
            workbookSummary: {
              sheets: 3,
              sheetsTotal: 3,
              formulas: 40,
              rules: 2,
              cut: [],
              valuesCut: [],
            },
          }],
          resolveDelivery,
        },
      })
      const hint = wrapper.get('[data-testid="files-delivery-hint"]')

      expect(hint.text()).toBe('3 sheets · formulas')
      expect(hint.attributes('aria-label')).toBe('3 sheets · formulas')
      expect(hint.attributes('title')).toMatch(/^3 sheets · formulas: /)
      expect(hint.classes()).toContain('max-w-36')
      expect(hint.get('span').classes()).toContain('truncate')
      expect(hint.element.tagName).toBe('BUTTON')
      expect(hint.attributes('aria-expanded')).toBe('false')
      expect(wrapper.find('[data-testid="files-delivery-hint-note"]').exists())
        .toBe(false)
    })

    const googleMapFile = {
      storageKey: 'map-key',
      name: 'Budget (workbook map).md',
      type: 'text/markdown',
      size: 9000,
      textStatus: 'ready' as const,
      textVersion: 2,
      externalSource: 'google' as const,
      workbookSummary: {
        sheets: 5,
        sheetsTotal: 5,
        formulas: 12,
        rules: 3,
        cut: [],
        valuesCut: [],
      },
    }

    it('shows the map of a Google Sheet as a chip with a note in tabs, '
      + 'not as a text card', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: { files: [googleMapFile], resolveDelivery },
      })
      const hint = wrapper.get('[data-testid="files-delivery-hint"]')

      expect(wrapper.find('[data-testid="files-preview-text-open"]').exists())
        .toBe(false)
      expect(hint.text()).toBe('5 tabs · formulas')

      await hint.trigger('click')

      expect(wrapper.get('[data-testid="files-delivery-hint-note"]').text())
        .toContain('every tab\'s values as they are displayed')
    })

    it('shows the first-tab fallback copy as a chip with its code in the '
      + 'note', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [{
            storageKey: 'csv-key',
            name: 'Budget (first tab).csv',
            type: 'text/csv',
            size: 80,
            externalSource: 'google' as const,
            sheetsFallback: {
              code: 'sheets_api_off' as const,
              status: 403,
              reason: 'SERVICE_DISABLED',
            },
          }],
          resolveDelivery,
        },
      })
      const hint = wrapper.get('[data-testid="files-delivery-hint"]')

      expect(hint.text()).toBe('First tab only')

      await hint.trigger('click')

      const note = wrapper.get('[data-testid="files-delivery-hint-note"]')

      expect(note.text()).toContain('Only the first tab of this spreadsheet '
        + 'was imported.')
      expect(note.text()).toContain('sheets_api_off (HTTP 403, '
        + 'SERVICE_DISABLED)')
    })

    it('keeps the text card for a Google Doc copy and for a CSV copy with '
      + 'no fallback', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [
            {
              storageKey: 'doc-key',
              name: 'Plan.md',
              type: 'text/markdown',
              size: 40,
              externalSource: 'google' as const,
            },
            {
              storageKey: 'csv-key',
              name: 'Budget (first tab).csv',
              type: 'text/csv',
              size: 40,
              externalSource: 'google' as const,
            },
          ],
          resolveDelivery,
        },
      })

      expect(wrapper.findAll('[data-testid="files-preview-text-open"]'))
        .toHaveLength(2)
      expect(wrapper.find('[data-testid="files-delivery-hint"]').exists())
        .toBe(false)
    })

    it('opens and closes the info note from the hint', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [{
            ...spreadsheetFile,
            textStatus: 'ready' as const,
            textVersion: 2,
          }],
          resolveDelivery,
        },
      })
      const hint = wrapper.get('[data-testid="files-delivery-hint"]')

      await hint.trigger('click')

      const note = wrapper.get('[data-testid="files-delivery-hint-note"]')

      expect(hint.attributes('aria-expanded')).toBe('true')
      expect(hint.attributes('aria-controls')).toBe(note.attributes('id'))
      expect(note.text()).toContain('budget.xlsx:')
      expect(note.text()).toContain('Colors, charts and images aren\'t sent.')

      await hint.trigger('click')

      expect(wrapper.find('[data-testid="files-delivery-hint-note"]').exists())
        .toBe(false)
    })

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
        '1 image not sent: The model gets this file\'s text only. Images, charts and formatting aren\'t sent.',
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
              ...spreadsheetFile,
              textStatus: 'ready' as const,
              textVersion: 2,
              textOmittedMedia: 2,
            }],
            resolveDelivery,
            convertedFromXlsKeys: new Set(['budget-key']),
          },
        })
        const note = wrapper.get('[data-testid="files-converted-note"]')
        const hint = wrapper.get('[data-testid="files-delivery-hint"]')

        expect(note.text()).toBe('Converted from .xls')
        expect(note.attributes('title')).toBe(
          'Converted to .xlsx in your browser before upload. Formulas keep '
          + 'their last calculated values. Styles, charts and macros are not '
          + 'kept.',
        )
        expect(hint.text()).toBe('Values and formulas')
        expect(hint.attributes('title')).toContain('2 images aren\'t sent.')
      })

    it('shows no converted note for a file that was not converted',
      async () => {
        const wrapper = await mountSuspended(Preview, {
          props: {
            files: [{ ...spreadsheetFile, textStatus: 'ready' as const }],
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

  describe('Google Drive copies', () => {
    const driveCopy = {
      storageKey: 'drive-key.md',
      name: 'Plan.md',
      type: 'text/markdown',
      size: 12,
      externalSource: 'google' as const,
    }

    it('marks a Drive copy with the Drive mark, like an upload otherwise',
      async () => {
        const wrapper = await mountSuspended(Preview, {
          props: {
            files: [
              driveCopy,
              { storageKey: 'plain', name: 'b.txt', type: 'text/plain', size: 1 },
            ],
          },
        })
        const marks = wrapper.findAll('[data-testid="files-preview-drive-mark"]')

        expect(marks).toHaveLength(1)
        expect(marks[0]!.attributes('title')).toBe('Google Drive')
        expect(marks[0]!.attributes('aria-label')).toBe(
          'Plan.md is a copy of a Google Drive file',
        )
        expect(wrapper.findAll('[data-testid="carousel-item"]')).toHaveLength(2)
      })

    it('can still be detached like any attached file', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: { files: [driveCopy] },
      })

      expect(wrapper.find('[data-testid="files-preview-detach"]').exists())
        .toBe(true)
    })

    it('shows a file being copied with progress and no dismiss button',
      async () => {
        const wrapper = await mountSuspended(Preview, {
          props: {
            files: [],
            driveImports: [{ id: 'd1', name: 'Plan', status: 'importing' }],
          },
        })
        const item = wrapper.get('[data-testid="drive-import-item"]')

        expect(item.attributes('role')).toBe('group')
        expect(item.attributes('aria-label'))
          .toBe('Plan, copying from Google Drive')
        expect(item.get('[data-testid="drive-import-status"]').text())
          .toContain('Copying')
        expect(item.find('progress').exists()).toBe(true)
        expect(item.find('[data-testid="drive-import-dismiss"]').exists())
          .toBe(false)
      })

    it('shows one short line for a failed file, the sentence behind a click, '
      + 'and lets the user dismiss it', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [],
          driveImports: [{
            id: 'd1',
            name: 'Plan',
            status: 'failed',
            error: 'This file is too large to attach.',
            code: 'too_large',
            detail: 'Google: notFound, export',
          }],
        },
      })
      const line = wrapper.get('[data-testid="drive-import-error"]')

      expect(line.text()).toBe('Could not import')
      expect(line.attributes('aria-expanded')).toBe('false')
      expect(wrapper.find('[data-testid="drive-import-note"]').exists())
        .toBe(false)
      expect(wrapper.find('progress').exists()).toBe(false)

      await line.trigger('click')

      expect(line.attributes('aria-expanded')).toBe('true')
      expect(wrapper.get('[data-testid="drive-import-note-text"]').text())
        .toBe('This file is too large to attach.')
      expect(wrapper.get('[data-testid="drive-import-note-detail"]').text())
        .toBe('(Google: notFound, export)')

      await wrapper.get('[data-testid="drive-import-dismiss"]')
        .trigger('click')

      expect(wrapper.emitted('dismiss-drive-import')).toEqual([['d1']])
    })

    it('asks to pick the file again from the note, only where it can help',
      async () => {
        const wrapper = await mountSuspended(Preview, {
          props: {
            files: [],
            driveImports: [{
              id: 'd1',
              name: 'Plan',
              status: 'failed',
              error: 'Pick it again.',
              code: 'not_found',
            }],
          },
        })

        await wrapper.get('[data-testid="drive-import-error"]')
          .trigger('click')
        await wrapper.get('[data-testid="drive-import-pick-again"]')
          .trigger('click')

        expect(wrapper.emitted('pick-again-drive-import')).toEqual([['d1']])
        expect(wrapper.find('[data-testid="drive-import-note"]').exists())
          .toBe(false)

        await wrapper.setProps({
          driveImports: [{
            id: 'd2',
            name: 'Huge',
            status: 'failed',
            error: 'Too large.',
            code: 'too_large',
          }],
        })
        await wrapper.get('[data-testid="drive-import-error"]')
          .trigger('click')

        expect(wrapper.find('[data-testid="drive-import-pick-again"]').exists())
          .toBe(false)
        expect(wrapper.find('[data-testid="drive-import-remove"]').exists())
          .toBe(true)
      })

    it('closes the note when its file is removed', async () => {
      const failed = {
        id: 'd1',
        name: 'Plan',
        status: 'failed' as const,
        error: 'Nope.',
      }
      const wrapper = await mountSuspended(Preview, {
        props: { files: [], driveImports: [failed] },
      })

      await wrapper.get('[data-testid="drive-import-error"]').trigger('click')
      await wrapper.get('[data-testid="drive-import-remove"]').trigger('click')

      expect(wrapper.emitted('dismiss-drive-import')).toEqual([['d1']])

      await wrapper.setProps({ driveImports: [] })

      expect(wrapper.find('[data-testid="drive-import-note"]').exists())
        .toBe(false)
    })

    describe('keyboard and screen reader use of the note', () => {
      const failed = {
        id: 'd1',
        name: 'Plan',
        status: 'failed' as const,
        error: 'Besidka cannot see this file.',
        code: 'not_found' as const,
        detail: 'Google: notFound, export',
      }

      it('moves focus into the note when it opens and announces its '
        + 'text in the status region', async () => {
        const wrapper = await mountSuspended(Preview, {
          props: { files: [], driveImports: [failed] },
          attachTo: document.body,
        })
        const status = wrapper.get('[role="status"]')

        expect(status.text()).toBe('')

        await wrapper.get('[data-testid="drive-import-error"]')
          .trigger('click')
        await wrapper.vm.$nextTick()
        await wrapper.vm.$nextTick()

        expect(document.activeElement).toBe(
          wrapper.get('[data-testid="drive-import-note"]').element,
        )
        expect(status.text()).toBe(
          'Plan: Besidka cannot see this file.: (Google: notFound, export)',
        )

        wrapper.unmount()
      })

      it('keeps one status region for uploads and the note', async () => {
        const wrapper = await mountSuspended(Preview, {
          props: { files: [], driveImports: [failed] },
        })

        expect(wrapper.findAll('[role="status"]')).toHaveLength(1)
      })

      it('returns focus to the chip button on Escape', async () => {
        const wrapper = await mountSuspended(Preview, {
          props: { files: [], driveImports: [failed] },
          attachTo: document.body,
        })
        const button = wrapper.get('[data-testid="drive-import-error"]')

        await button.trigger('click')
        await wrapper.vm.$nextTick()
        await wrapper.get('[data-testid="drive-import-note"]')
          .trigger('keydown', { key: 'Escape' })
        await wrapper.vm.$nextTick()
        await wrapper.vm.$nextTick()

        expect(wrapper.find('[data-testid="drive-import-note"]').exists())
          .toBe(false)
        expect(document.activeElement).toBe(button.element)

        wrapper.unmount()
      })

      it('moves focus to the chip, not to nowhere, after Pick again',
        async () => {
          const wrapper = await mountSuspended(Preview, {
            props: { files: [], driveImports: [failed] },
            attachTo: document.body,
          })

          await wrapper.get('[data-testid="drive-import-error"]')
            .trigger('click')
          await wrapper.vm.$nextTick()
          await wrapper.get('[data-testid="drive-import-pick-again"]')
            .trigger('click')
          await wrapper.vm.$nextTick()
          await wrapper.vm.$nextTick()

          expect(document.activeElement).toBe(
            wrapper.get('[data-testid="drive-import-item"]').element,
          )

          wrapper.unmount()
        })

      it('moves focus to the next failed chip, or the textarea, when a '
        + 'file is removed', async () => {
        const textarea = document.createElement('textarea')

        textarea.className = 'js-chat-input-textarea'
        document.body.appendChild(textarea)

        const second = { ...failed, id: 'd2', name: 'Notes' }
        let remaining = [failed, second]
        const wrapper = await mountSuspended(Preview, {
          props: {
            files: [],
            driveImports: remaining,
            onDismissDriveImport: (id: string) => {
              remaining = remaining.filter(item => item.id !== id)
              wrapper.setProps({ driveImports: remaining })
            },
          },
          attachTo: document.body,
        })

        await wrapper.findAll('[data-testid="drive-import-dismiss"]')[0]!
          .trigger('click')
        await flushPromises()

        expect(document.activeElement).toBe(
          wrapper.get('[data-testid="drive-import-error"]').element,
        )

        await wrapper.get('[data-testid="drive-import-dismiss"]')
          .trigger('click')
        await flushPromises()

        expect(document.activeElement).toBe(textarea)

        wrapper.unmount()
        textarea.remove()
      })
    })

    it('keeps a failed chip as tall as a normal file chip', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [],
          driveImports: [{
            id: 'd1',
            name: 'Plan',
            status: 'failed',
            error: 'A long sentence '.repeat(20),
          }],
        },
      })
      const chip = wrapper.get('[data-testid="drive-import-item"]')

      expect(chip.html()).toContain('size-14')
      expect(chip.text()).not.toContain('A long sentence')
    })

    it('does not count a file being copied in Detach all', async () => {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files,
          driveImports: [{ id: 'd1', name: 'Plan', status: 'importing' }],
        },
      })

      expect(wrapper.get('[data-testid="files-preview-detach-all"]').text())
        .toContain('2')
    })
  })

  describe('link check skeleton', () => {
    const documentFile = {
      storageKey: 'doc',
      name: 'Quarterly plan.pdf',
      type: 'application/pdf',
      size: 10,
    }

    async function mountWithSkeletonAndChip() {
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [documentFile],
          tiles: [createTile({})],
          checkingLinkCount: 1,
        },
      })

      return {
        skeleton: wrapper.get('[data-testid="google-link-skeleton"]'),
        chip: wrapper.get('[data-testid="carousel-item"]'),
      }
    }

    it('keeps the status role and the accessible name', async () => {
      const { skeleton } = await mountWithSkeletonAndChip()

      expect(skeleton.attributes('role')).toBe('status')
      expect(skeleton.attributes('aria-label')).toBe('Checking Google link')
    })

    it('renders through the same shell classes as a real chip', async () => {
      const { skeleton, chip } = await mountWithSkeletonAndChip()
      const skeletonCard = skeleton.element.firstElementChild
      const chipCard = chip.element.firstElementChild

      expect(skeleton.classes().sort()).toEqual(chip.classes().sort())
      expect(skeletonCard?.className).toBe(chipCard?.className)
    })

    it('uses the same preview box size as a real chip', async () => {
      const { skeleton, chip } = await mountWithSkeletonAndChip()
      const skeletonPreview = skeleton.get(
        '[data-testid="google-link-skeleton-preview"]',
      )
      const chipPreview = chip.element.querySelector('.size-14')

      expect(skeletonPreview.element.className).toBe(chipPreview?.className)
    })

    it('keeps the placeholders inside the preview box and text block',
      async () => {
        const { skeleton } = await mountWithSkeletonAndChip()
        const placeholders = skeleton.findAll('.skeleton')

        expect(placeholders).toHaveLength(3)
        expect(placeholders[0]?.classes()).toContain('size-full')
        expect(placeholders[1]?.classes()).toContain('h-3')
        expect(placeholders[2]?.classes()).toContain('h-2.5')
      })

    it('uses the same shell classes as an uploading chip', async () => {
      const uploadingFiles = new Map([
        ['up', {
          id: 'up',
          file: new File(['x'], 'upload.pdf', { type: 'application/pdf' }),
          status: 'uploading',
          progress: 40,
        }],
      ])
      const wrapper = await mountSuspended(Preview, {
        props: {
          files: [],
          checkingLinkCount: 1,
          uploadingFiles: uploadingFiles as never,
        },
      })
      const skeleton = wrapper.get('[data-testid="google-link-skeleton"]')
      const uploading = wrapper.get('[data-uploading-id="up"]')

      expect(skeleton.classes().sort()).toEqual(uploading.classes().sort())
      expect(skeleton.element.firstElementChild?.className)
        .toBe(uploading.element.firstElementChild?.className)
    })
  })
})
