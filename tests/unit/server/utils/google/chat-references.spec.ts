import { describe, expect, it } from 'vitest'
import {
  createGoogleReferenceIndex,
  isDriveRootItem,
  isListableFolderId,
} from '~~/server/utils/google/chat-references'
import {
  redactGoogleToolPartsForPersistence,
} from '~~/server/utils/tool-approval/google'
import { withoutReferenceNames } from '#shared/utils/google-tool-approvals'

const ROOT_ID = 'real-root-id-0123456789'
const FOLDER_ID = 'folder-id-0123456789'
const CHILD_FILE_ID = 'child-file-id-0123456'
const FOUND_ID = 'found-file-id-0123456'
const PICKED_ID = 'picked-file-id-0123456'
const PARENT_ID = 'parent-folder-id-01234'

function part(toolName: string, references: unknown[]) {
  return {
    type: `tool-${toolName}`,
    state: 'output-available',
    output: { references, bodyRemoved: true },
  }
}

describe('the Drive folder reference index', () => {
  const parts = [
    part('google__drive_list_folder', [
      { id: ROOT_ID, kind: 'drive-root', title: 'Forged name' },
      {
        id: FOLDER_ID,
        kind: 'drive-folder',
        title: 'Projects',
        parentId: ROOT_ID,
      },
      {
        id: CHILD_FILE_ID,
        kind: 'drive-file',
        title: 'notes.txt',
        parentId: ROOT_ID,
      },
    ]),
    part('google__drive_search', [
      { id: FOUND_ID, kind: 'drive-file', title: 'Plan', parentId: PARENT_ID },
    ]),
    part('google__drive_list_picked', [
      { id: PICKED_ID, kind: 'drive-file', title: 'Picked' },
    ]),
    part('google__drive_create_folder', [
      { id: 'created-id-0123456789', kind: 'drive-folder', title: 'Made' },
    ]),
  ]

  it('always knows My Drive under the alias, with the fixed title', () => {
    const index = createGoogleReferenceIndex([])

    expect(index.folders.get('root')).toMatchObject({
      id: 'root',
      title: 'My Drive',
      kind: 'drive-root',
    })
    expect(isDriveRootItem(index.folders.get('root'))).toBe(true)
  })

  it('collects folders from listings and creates, never from a search or '
    + 'a picked file', () => {
    const index = createGoogleReferenceIndex([parts])

    expect([...index.folders.keys()].sort()).toEqual([
      'created-id-0123456789',
      FOLDER_ID,
      ROOT_ID,
      'root',
    ].sort())
  })

  it('takes the title of the real root from our code, not from Google',
    () => {
      const index = createGoogleReferenceIndex([parts])

      expect(index.folders.get(ROOT_ID)?.title).toBe('My Drive')
    })

  it('collects writable items from searches, listings and creates only',
    () => {
      const index = createGoogleReferenceIndex([parts])

      expect([...index.writableItems.keys()].sort()).toEqual([
        'created-id-0123456789',
        CHILD_FILE_ID,
        FOLDER_ID,
        FOUND_ID,
      ].sort())
      expect(index.writableItems.has(PICKED_ID)).toBe(false)
      expect(index.writableItems.has(ROOT_ID)).toBe(false)
    })

  it('never lets a listed file become a readable found file', () => {
    const index = createGoogleReferenceIndex([parts])

    expect([...index.foundFiles.keys()]).toEqual([FOUND_ID])
  })

  it('keeps the parent id of an item and drops one of the wrong shape', () => {
    const index = createGoogleReferenceIndex([[
      part('google__drive_list_folder', [
        {
          id: FOLDER_ID,
          kind: 'drive-folder',
          title: 'Projects',
          parentId: 'bad parent!',
        },
        {
          id: CHILD_FILE_ID,
          kind: 'drive-file',
          title: 'notes.txt',
          parentId: PARENT_ID,
        },
      ]),
    ]])

    expect(index.writableItems.get(FOLDER_ID)).not.toHaveProperty('parentId')
    expect(index.writableItems.get(CHILD_FILE_ID)?.parentId).toBe(PARENT_ID)
  })

  it('opens the folder of a known item but accepts it as a listing '
    + 'target only', () => {
    const index = createGoogleReferenceIndex([parts])

    expect(isListableFolderId(index, FOLDER_ID)).toBe(true)
    expect(isListableFolderId(index, PARENT_ID)).toBe(true)
    expect(isListableFolderId(index, 'unknown-folder-id-0123')).toBe(false)
    expect(index.folders.has(PARENT_ID)).toBe(false)
  })

  it('grows with the results of the current send', () => {
    const index = createGoogleReferenceIndex([])

    index.addFolders({
      references: [{ id: FOLDER_ID, kind: 'drive-folder', title: 'Projects' }],
    })
    index.addWritableItems({
      references: [{ id: FOLDER_ID, kind: 'drive-folder', title: 'Projects' }],
    })
    index.addFolders({
      references: [{ id: FOUND_ID, kind: 'drive-file', title: 'Plan' }],
    })

    expect(index.folders.has(FOLDER_ID)).toBe(true)
    expect(index.writableItems.has(FOLDER_ID)).toBe(true)
    expect(index.folders.has(FOUND_ID)).toBe(false)
  })

  it('ignores an output that is not in the output-available state', () => {
    const index = createGoogleReferenceIndex([[{
      type: 'tool-google__drive_list_folder',
      state: 'input-available',
      output: { references: [{ id: FOLDER_ID, kind: 'drive-folder' }] },
    }]])

    expect(index.folders.has(FOLDER_ID)).toBe(false)
  })
})

describe('the parent id in a stored reference', () => {
  const output = {
    references: [{
      id: FOLDER_ID,
      kind: 'drive-folder',
      title: 'Projects',
      link: `https://drive.google.com/open?id=${FOLDER_ID}`,
      parentId: PARENT_ID,
    }],
    items: 'framed text with names',
  }

  it('survives the references-only form kept in D1', () => {
    const [stored] = redactGoogleToolPartsForPersistence([{
      type: 'tool-google__drive_list_folder',
      toolCallId: 'call-1',
      state: 'output-available',
      input: {},
      output,
    }] as never) as unknown as Array<{ output: Record<string, unknown> }>

    expect(stored!.output.references).toEqual(output.references)
    expect(JSON.stringify(stored)).not.toContain('framed text')
  })

  it('drops a parent id of the wrong shape', () => {
    const [stored] = redactGoogleToolPartsForPersistence([{
      type: 'tool-google__drive_list_folder',
      toolCallId: 'call-1',
      state: 'output-available',
      input: {},
      output: {
        references: [{ id: FOLDER_ID, parentId: 'x y z' }],
      },
    }] as never) as unknown as Array<{ output: { references: unknown[] } }>

    expect(stored!.output.references).toEqual([{ id: FOLDER_ID }])
  })

  it('stays after the names are taken out for the model', () => {
    expect(withoutReferenceNames(output)).toMatchObject({
      references: [{
        id: FOLDER_ID,
        kind: 'drive-folder',
        parentId: PARENT_ID,
      }],
    })
    expect(JSON.stringify(withoutReferenceNames(output)))
      .not.toContain('Projects')
  })
})
