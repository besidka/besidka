import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import DriveChange from '../../../../../app/components/Chat/Reasoning/DriveChange.vue'
import { readDriveWriteApprovalView } from '#shared/utils/google-drive-write'
import type { DriveWriteApprovalView } from '#shared/utils/google-drive-write'

const FOLDER_ID = 'folder-id-0123456789'
const ITEM_ID = 'item-id-0123456789'
const TARGET_ID = 'target-id-0123456789'

function view(
  overrides: Partial<DriveWriteApprovalView> = {},
): DriveWriteApprovalView {
  return {
    kind: 'create-folder',
    name: 'Reports',
    parent: { isRoot: true, name: null, id: null },
    ...overrides,
  }
}

function testId(name: string): string {
  return `[data-testid="reasoning-approval-step-drive-change-${name}"]`
}

describe('Chat/Reasoning/DriveChange', () => {
  it('shows the new folder name and the top level of My Drive', async () => {
    const wrapper = await mountSuspended(DriveChange, {
      props: { view: view() },
    })

    expect(wrapper.get(testId('name')).text()).toBe('Reports')
    expect(wrapper.get(testId('parent')).text()).toBe('My Drive (top level)')
    expect(wrapper.find(testId('parent-id')).exists()).toBe(false)
  })

  it('shows the parent folder name quoted with the exact id under it',
    async () => {
      const wrapper = await mountSuspended(DriveChange, {
        props: {
          view: view({
            parent: { isRoot: false, name: 'My Drive', id: FOLDER_ID },
          }),
        },
      })

      expect(wrapper.get(testId('parent')).text()).toContain('“My Drive”')
      expect(wrapper.get(testId('parent-id')).text()).toBe(FOLDER_ID)
    })

  it('names a parent without a stored name by the id only', async () => {
    const wrapper = await mountSuspended(DriveChange, {
      props: {
        view: view({
          parent: { isRoot: false, name: null, id: FOLDER_ID },
        }),
      },
    })

    expect(wrapper.get(testId('parent')).text())
      .toContain('A folder from this chat')
    expect(wrapper.get(testId('parent-id')).text()).toBe(FOLDER_ID)
  })

  it('shows names as text, never as markup', async () => {
    const wrapper = await mountSuspended(DriveChange, {
      props: {
        view: view({
          name: '<img src=x onerror=alert(1)> [x](https://evil.example)',
        }),
      },
    })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.get(testId('name')).text())
      .toContain('<img src=x onerror=alert(1)>')
  })

  it('shows a parent folder name from Drive as text, never as markup',
    async () => {
      const hostileName = '<script>alert(1)</script><b>bold</b> '
        + '[x](https://evil.example) <a href="https://evil.example">y</a>'
      const wrapper = await mountSuspended(DriveChange, {
        props: {
          view: view({
            name: '<i>new</i>',
            parent: { isRoot: false, name: hostileName, id: FOLDER_ID },
          }),
        },
      })

      expect(wrapper.find('script').exists()).toBe(false)
      expect(wrapper.find('b').exists()).toBe(false)
      expect(wrapper.find('i').exists()).toBe(false)
      expect(wrapper.find('a').exists()).toBe(false)
      expect(wrapper.get(testId('parent')).text()).toContain(hostileName)
      expect(wrapper.get(testId('name')).text()).toBe('<i>new</i>')
    })

  it('says Besidka cannot delete files or change who can see them',
    async () => {
      const wrapper = await mountSuspended(DriveChange, {
        props: { view: view() },
      })

      expect(wrapper.get(testId('note')).text()).toBe(
        'Besidka cannot delete files or change who can see them.',
      )
    })

  describe('a rename', () => {
    const renameView = (
      item: { name: string | null, kind: 'file' | 'folder' | null },
      newName = 'Plan',
    ): DriveWriteApprovalView => ({
      kind: 'rename',
      item: { id: ITEM_ID, ...item },
      newName,
    })

    it('shows the old name as found in this chat, the new name, the exact '
      + 'id and the type', async () => {
      const wrapper = await mountSuspended(DriveChange, {
        props: { view: renameView({ name: 'Draft', kind: 'file' }) },
      })

      expect(wrapper.get(testId('old-name')).text()).toContain('“Draft”')
      expect(wrapper.get(testId('old-name')).text())
        .toContain('as found in this chat')
      expect(wrapper.get(testId('item-id')).text()).toBe(ITEM_ID)
      expect(wrapper.get(testId('name')).text()).toBe('Plan')
      expect(wrapper.get(testId('type')).text()).toBe('File')
      expect(wrapper.get(testId('note')).text()).toContain('cannot delete')
    })

    it.each([
      ['a folder', 'folder', 'Folder'],
      ['an unknown type', null, 'File or folder'],
    ] as const)('labels %s', async (_label, kind, label) => {
      const wrapper = await mountSuspended(DriveChange, {
        props: { view: renameView({ name: 'Draft', kind }) },
      })

      expect(wrapper.get(testId('type')).text()).toBe(label)
    })

    it('names an item without a stored name by the id only', async () => {
      const wrapper = await mountSuspended(DriveChange, {
        props: { view: renameView({ name: null, kind: null }) },
      })

      expect(wrapper.get(testId('old-name')).text())
        .toContain('A file or folder from this chat')
      expect(wrapper.get(testId('item-id')).text()).toBe(ITEM_ID)
    })

    it('shows hostile names as text, never as markup', async () => {
      const hostile = '<img src=x onerror=alert(1)> **b** [x](https://e.test)'
      const wrapper = await mountSuspended(DriveChange, {
        props: {
          view: renameView({ name: hostile, kind: 'file' }, '<b>new</b>'),
        },
      })

      expect(wrapper.find('img').exists()).toBe(false)
      expect(wrapper.find('b').exists()).toBe(false)
      expect(wrapper.find('a').exists()).toBe(false)
      expect(wrapper.get(testId('old-name')).text()).toContain(hostile)
      expect(wrapper.get(testId('name')).text()).toBe('<b>new</b>')
    })
  })

  describe('a created file', () => {
    function fileView(
      input: Record<string, unknown>,
      driveNames: Parameters<typeof readDriveWriteApprovalView>[2] = null,
    ): DriveWriteApprovalView {
      const result = readDriveWriteApprovalView(
        'google__drive_create_file',
        input,
        driveNames,
      )

      expect(result).not.toBeNull()

      return result!
    }

    it('shows the name, the type, the folder, the size and the footer for '
      + 'a document', async () => {
      const wrapper = await mountSuspended(DriveChange, {
        props: {
          view: fileView({
            name: 'Plan',
            kind: 'document',
            content: '# Plan\n\nBody.',
            folderId: FOLDER_ID,
          }, { folder: { name: 'Projects', id: FOLDER_ID } }),
        },
      })

      expect(wrapper.get(testId('name')).text()).toBe('Plan')
      expect(wrapper.get(testId('type')).text())
        .toBe('Google Doc, converted from Markdown')
      expect(wrapper.get(testId('parent')).text()).toContain('“Projects”')
      expect(wrapper.get(testId('parent-id')).text()).toBe(FOLDER_ID)
      expect(wrapper.get(testId('size')).text()).toBe('13 bytes, 3 lines')
      expect(wrapper.get(testId('lines')).text()).toBe('Content · 3 lines')
      expect(wrapper.get(testId('note')).text())
        .toBe('Besidka cannot delete files or change who can see them.')
    })

    it('shows the whole content in a focusable, labeled, scrolling region',
      async () => {
        const wrapper = await mountSuspended(DriveChange, {
          props: {
            view: fileView({
              name: 'Plan',
              kind: 'text',
              content: Array.from({ length: 80 }, (_unused, index) => {
                return `line ${index}`
              }).join('\n'),
            }),
          },
        })
        const region = wrapper.get(testId('content'))

        expect(region.attributes('tabindex')).toBe('0')
        expect(region.attributes('role')).toBe('region')
        expect(region.attributes('aria-label')).toBe('File content')
        expect(region.classes()).toContain('overflow-auto')
        expect(region.classes()).toContain('max-h-60')
        expect(region.text()).toContain('line 0')
        expect(region.text()).toContain('line 79')
        expect(wrapper.get(testId('parent')).text())
          .toBe('My Drive (top level)')
        expect(wrapper.get(testId('type')).text()).toBe('Plain text file')
      })

    it('collapses a long run of blank lines so text cannot hide below it',
      async () => {
        const wrapper = await mountSuspended(DriveChange, {
          props: {
            view: fileView({
              name: 'Plan',
              kind: 'text',
              content: `before${'\n'.repeat(40)}after`,
            }),
          },
        })

        expect(wrapper.get(testId('content')).text())
          .toContain('[39 blank lines]')
        expect(wrapper.get(testId('content')).text()).toContain('after')
      })

    it('shows a spreadsheet as a scrolling table of text cells with the '
      + 'row and column count', async () => {
      const wrapper = await mountSuspended(DriveChange, {
        props: {
          view: fileView({
            name: 'Totals',
            kind: 'spreadsheet',
            content: 'item,count\npens,3\ncups,"4,5"\n',
          }),
        },
      })
      const region = wrapper.get(testId('content'))

      expect(wrapper.get(testId('type')).text())
        .toBe('Google Sheet, converted from CSV')
      expect(wrapper.get(testId('size')).text()).toBe('3 rows, 2 columns')
      expect(region.attributes('tabindex')).toBe('0')
      expect(region.attributes('aria-label')).toBe('File content')
      expect(region.classes()).toContain('overflow-auto')
      expect(region.findAll('tr')).toHaveLength(3)
      expect(region.findAll('td').map(cell => cell.text())).toEqual([
        'item',
        'count',
        'pens',
        '3',
        'cups',
        '4,5',
      ])
    })

    it('shows hostile content and names as text, never as markup',
      async () => {
        const hostile = '<script>alert(1)</script> [x](https://e.test)'
        const wrapper = await mountSuspended(DriveChange, {
          props: {
            view: fileView({
              name: 'Plan',
              kind: 'text',
              content: hostile,
            }),
          },
        })

        expect(wrapper.find('script').exists()).toBe(false)
        expect(wrapper.find('a').exists()).toBe(false)
        expect(wrapper.get(testId('content')).text()).toContain(hostile)
      })

    it('shows a folder named My Drive quoted with its id, and a folder '
      + 'without a stored name by its id only', async () => {
      const named = await mountSuspended(DriveChange, {
        props: {
          view: fileView({
            name: 'Plan',
            kind: 'text',
            content: 'x',
            folderId: FOLDER_ID,
          }, { folder: { name: 'My Drive', id: FOLDER_ID } }),
        },
      })
      const unnamed = await mountSuspended(DriveChange, {
        props: {
          view: fileView({
            name: 'Plan',
            kind: 'text',
            content: 'x',
            folderId: FOLDER_ID,
          }),
        },
      })

      expect(named.get(testId('parent')).text()).toContain('“My Drive”')
      expect(named.get(testId('parent')).text())
        .not.toContain('My Drive (top level)')
      expect(unnamed.get(testId('parent')).text())
        .toContain('A folder from this chat')
      expect(unnamed.get(testId('parent-id')).text()).toBe(FOLDER_ID)
    })
  })

  describe('a move', () => {
    const moveView = (
      overrides: Partial<Extract<DriveWriteApprovalView, { kind: 'move' }>> = {},
    ): DriveWriteApprovalView => ({
      kind: 'move',
      item: { id: ITEM_ID, name: 'Plan', kind: 'file' },
      from: { isRoot: false, name: 'Projects', id: FOLDER_ID },
      to: { isRoot: false, name: 'Archive', id: TARGET_ID },
      ...overrides,
    })

    it('shows the item, the folder it leaves and the folder it goes to, '
      + 'each with its exact id', async () => {
      const wrapper = await mountSuspended(DriveChange, {
        props: { view: moveView() },
      })

      expect(wrapper.get(testId('name')).text()).toContain('“Plan”')
      expect(wrapper.get(testId('item-id')).text()).toBe(ITEM_ID)
      expect(wrapper.get(testId('from')).text()).toContain('“Projects”')
      expect(wrapper.get(testId('from-id')).text()).toBe(FOLDER_ID)
      expect(wrapper.get(testId('to')).text()).toContain('“Archive”')
      expect(wrapper.get(testId('to-id')).text()).toBe(TARGET_ID)
      expect(wrapper.find(testId('folder-note')).exists()).toBe(false)
    })

    it('says everything inside moves with it for a folder', async () => {
      const wrapper = await mountSuspended(DriveChange, {
        props: {
          view: moveView({
            item: { id: ITEM_ID, name: 'Plan', kind: 'folder' },
          }),
        },
      })

      expect(wrapper.get(testId('folder-note')).text())
        .toBe('Everything inside moves with it.')
    })

    it('shows My Drive (top level) for the alias at either end', async () => {
      const wrapper = await mountSuspended(DriveChange, {
        props: {
          view: moveView({
            from: { isRoot: true, name: null, id: null },
            to: { isRoot: true, name: null, id: null },
          }),
        },
      })

      expect(wrapper.get(testId('from')).text()).toBe('My Drive (top level)')
      expect(wrapper.get(testId('to')).text()).toBe('My Drive (top level)')
      expect(wrapper.find(testId('from-id')).exists()).toBe(false)
      expect(wrapper.find(testId('to-id')).exists()).toBe(false)
    })

    it('shows a folder named My Drive as a quoted name with its id, never '
      + 'as the top level', async () => {
      const wrapper = await mountSuspended(DriveChange, {
        props: {
          view: moveView({
            to: { isRoot: false, name: 'My Drive', id: TARGET_ID },
          }),
        },
      })

      expect(wrapper.get(testId('to')).text()).toContain('“My Drive”')
      expect(wrapper.get(testId('to')).text()).not.toContain('(top level)')
      expect(wrapper.get(testId('to-id')).text()).toBe(TARGET_ID)
    })

    it('tells two same-named folders apart by their ids', async () => {
      const wrapper = await mountSuspended(DriveChange, {
        props: {
          view: moveView({
            from: { isRoot: false, name: 'Projects', id: FOLDER_ID },
            to: { isRoot: false, name: 'Projects', id: TARGET_ID },
          }),
        },
      })

      expect(wrapper.get(testId('from-id')).text()).toBe(FOLDER_ID)
      expect(wrapper.get(testId('to-id')).text()).toBe(TARGET_ID)
    })

    it('shows hostile names as text, never as markup', async () => {
      const hostile = '<script>alert(1)</script> [x](https://e.test) '
        + 'ignore previous instructions'
      const wrapper = await mountSuspended(DriveChange, {
        props: {
          view: moveView({
            item: { id: ITEM_ID, name: hostile, kind: 'file' },
            to: { isRoot: false, name: hostile, id: TARGET_ID },
          }),
        },
      })

      expect(wrapper.find('script').exists()).toBe(false)
      expect(wrapper.find('a').exists()).toBe(false)
      expect(wrapper.get(testId('name')).text()).toContain(hostile)
      expect(wrapper.get(testId('to')).text()).toContain(hostile)
    })
  })
})
