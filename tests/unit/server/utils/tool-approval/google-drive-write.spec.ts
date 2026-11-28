import { describe, expect, it } from 'vitest'
import {
  GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME,
  GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME,
  GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME,
  GOOGLE_DRIVE_MOVE_TOOL_NAME,
  GOOGLE_DRIVE_RENAME_TOOL_NAME,
  GOOGLE_DRIVE_WRITE_TOOL_NAMES,
  getGoogleDriveToolStepTitle,
  isGoogleDriveToolName,
} from '#shared/utils/google-drive-tools'
import {
  GOOGLE_CHAT_GRANT_RUNS_PER_MESSAGE,
  isGoogleOnceOnlyReadTool,
} from '#shared/utils/google-gmail-tools'
import {
  GOOGLE_TOOL_CHAT_GRANT_LABELS,
  GOOGLE_TOOL_PROPERTIES,
  googleToolResultHoldsContent,
  isGoogleWriteToolName,
} from '#shared/utils/google-tool-approvals'
import { resolveToolApproval } from '~~/server/utils/tool-approval/policy'
import type {
  ToolApprovalDescriptor,
  ToolApprovalGrant,
} from '~~/server/utils/tool-approval/policy'
import {
  createApprovalState,
  recordTaint,
} from '~~/server/utils/tool-approval/state'
import {
  hasGoogleToolResult,
  redactGoogleToolPartsForPersistence,
} from '~~/server/utils/tool-approval/google'

const HASH = 'a'.repeat(64)

function descriptor(
  toolName: string,
  overrides: Partial<ToolApprovalDescriptor> = {},
): ToolApprovalDescriptor {
  return {
    family: 'google',
    access: 'read',
    toolName,
    definitionHash: HASH,
    destructiveHint: false,
    ...overrides,
  }
}

function grant(toolName: string): ToolApprovalGrant {
  return { definitionHash: HASH, connectorId: null, toolName }
}

const WRITE = { access: 'write', destructiveHint: true } as const

describe('the Drive folder tools in the approval policy', () => {
  it('lets the folder list run under its own chat grant, five a message',
    () => {
      const asked = resolveToolApproval({
        descriptor: descriptor(GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME),
        state: createApprovalState(),
        permissionMode: 'ask',
      })
      const granted = resolveToolApproval({
        descriptor: descriptor(GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME),
        state: createApprovalState(),
        permissionMode: 'ask',
        chatGrant: grant(GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME),
      })

      expect(asked.rememberOptions).toEqual(['once', 'chat'])
      expect(granted.status.type).toBe('not-applicable')
      expect(isGoogleOnceOnlyReadTool(GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME))
        .toBe(false)
      expect(GOOGLE_CHAT_GRANT_RUNS_PER_MESSAGE[
        GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME
      ]).toBe(5)
      expect(GOOGLE_TOOL_CHAT_GRANT_LABELS[GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME])
        .toBe('Allow listing folders in your Google Drive in this chat')
    })

  it('asks for a folder with Allow once only, whatever grant or taint', () => {
    const decision = resolveToolApproval({
      descriptor: descriptor(GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME, WRITE),
      state: recordTaint(createApprovalState(), 'google'),
      permissionMode: 'ask',
      alwaysGrant: grant(GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME),
      chatGrant: grant(GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME),
    })

    expect(decision.reason).toBe('always-ask')
    expect(decision.status.type).toBe('user-approval')
    expect(decision.rememberOptions).toEqual(['once'])
  })

  it('counts the create as a write that Enter on its card never approves',
    () => {
      expect(isGoogleWriteToolName(GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME))
        .toBe(true)
      expect(isGoogleWriteToolName(GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME))
        .toBe(false)
    })

  it('keeps the list a Google content read and the create a call that '
    + 'returns none', () => {
    expect(GOOGLE_TOOL_PROPERTIES[GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME])
      .toEqual({ returnsGoogleContent: true })
    expect(GOOGLE_TOOL_PROPERTIES[GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME])
      .toEqual({ returnsGoogleContent: false })
    expect(googleToolResultHoldsContent(
      GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME,
      { references: [] },
    )).toBe(true)
    expect(googleToolResultHoldsContent(
      GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME,
      { references: [{ id: 'x' }] },
    )).toBe(false)
  })

  it('flags a chat that listed a folder and not one that only created one',
    () => {
      const part = (toolName: string) => ({
        parts: [{
          type: `tool-${toolName}`,
          state: 'output-available',
          output: { references: [{ id: 'folder-id-0123456789' }] },
        }],
      })

      expect(hasGoogleToolResult(
        part(GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME).parts,
      )).toBe(true)
      expect(hasGoogleToolResult(
        part(GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME).parts,
      )).toBe(false)
    })

  it('stores a created folder as a reference with its parent and no body',
    () => {
      const [stored] = redactGoogleToolPartsForPersistence([{
        type: `tool-${GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME}`,
        toolCallId: 'call-1',
        state: 'output-available',
        input: { name: 'Reports' },
        output: {
          references: [{
            id: 'folder-id-0123456789',
            kind: 'drive-folder',
            title: 'Reports',
            link: 'https://drive.google.com/open?id=folder-id-0123456789',
            parentId: 'parent-id-0123456789',
          }],
          created: true,
          message: 'The folder was created.',
        },
      }] as never) as unknown as Array<{ output: Record<string, unknown> }>

      expect(Object.keys(stored!.output).sort())
        .toEqual(['bodyRemoved', 'note', 'references'])
      expect(stored!.output.references).toEqual([{
        id: 'folder-id-0123456789',
        kind: 'drive-folder',
        title: 'Reports',
        link: 'https://drive.google.com/open?id=folder-id-0123456789',
        parentId: 'parent-id-0123456789',
      }])
    })

  it.each([
    GOOGLE_DRIVE_RENAME_TOOL_NAME,
    GOOGLE_DRIVE_MOVE_TOOL_NAME,
  ])('asks for %s with Allow once only, whatever grant or taint',
    (toolName) => {
      const decision = resolveToolApproval({
        descriptor: descriptor(toolName, WRITE),
        state: recordTaint(createApprovalState(), 'google'),
        permissionMode: 'ask',
        alwaysGrant: grant(toolName),
        chatGrant: grant(toolName),
      })

      expect(decision.reason).toBe('always-ask')
      expect(decision.status.type).toBe('user-approval')
      expect(decision.rememberOptions).toEqual(['once'])

      expect(isGoogleWriteToolName(toolName)).toBe(true)
      expect(GOOGLE_TOOL_PROPERTIES[toolName])
        .toEqual({ returnsGoogleContent: false })
      expect(GOOGLE_TOOL_CHAT_GRANT_LABELS[toolName]).toBeUndefined()
      expect(googleToolResultHoldsContent(
        toolName,
        { references: [{ id: 'x' }] },
      )).toBe(false)
    })

  it('does not flag a chat that only renamed or moved an item', () => {
    for (const toolName of [
      GOOGLE_DRIVE_RENAME_TOOL_NAME,
      GOOGLE_DRIVE_MOVE_TOOL_NAME,
    ]) {
      expect(hasGoogleToolResult([{
        type: `tool-${toolName}`,
        state: 'output-available',
        output: { references: [{ id: 'item-id-0123456789' }] },
      }])).toBe(false)
    }
  })

  it('stores a renamed item as a reference with no body', () => {
    const [stored] = redactGoogleToolPartsForPersistence([{
      type: `tool-${GOOGLE_DRIVE_RENAME_TOOL_NAME}`,
      toolCallId: 'call-1',
      state: 'output-available',
      input: { itemId: 'item-id-0123456789', newName: 'Plan' },
      output: {
        references: [{
          id: 'item-id-0123456789',
          kind: 'drive-file',
          title: 'Plan',
          link: 'https://drive.google.com/open?id=item-id-0123456789',
          parentId: 'parent-id-0123456789',
        }],
        renamed: true,
        alreadyDone: false,
        message: 'The item was renamed.',
      },
    }] as never) as unknown as Array<{ output: Record<string, unknown> }>

    expect(Object.keys(stored!.output).sort())
      .toEqual(['bodyRemoved', 'note', 'references'])
  })

  it('asks for a file with Allow once only, whatever grant or taint, and '
    + 'counts it as a write that returns no Google content', () => {
    const decision = resolveToolApproval({
      descriptor: descriptor(GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME, WRITE),
      state: recordTaint(createApprovalState(), 'google'),
      permissionMode: 'ask',
      alwaysGrant: grant(GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME),
      chatGrant: grant(GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME),
    })

    expect(decision.reason).toBe('always-ask')
    expect(decision.status.type).toBe('user-approval')
    expect(decision.rememberOptions).toEqual(['once'])
    expect(isGoogleWriteToolName(GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME))
      .toBe(true)
    expect(GOOGLE_TOOL_PROPERTIES[GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME])
      .toEqual({ returnsGoogleContent: false })
    expect(GOOGLE_TOOL_CHAT_GRANT_LABELS[GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME])
      .toBeUndefined()
    expect(googleToolResultHoldsContent(
      GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME,
      { references: [{ id: 'x' }] },
    )).toBe(false)
    expect(isGoogleDriveToolName(GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME))
      .toBe(true)
    expect(GOOGLE_DRIVE_WRITE_TOOL_NAMES)
      .toContain(GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME)
  })

  it('does not flag a chat that only created a file', () => {
    expect(hasGoogleToolResult([{
      type: `tool-${GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME}`,
      state: 'output-available',
      output: { references: [{ id: 'file-id-0123456789' }] },
    }])).toBe(false)
  })

  it('stores a created file as a reference with no body and no content',
    () => {
      const [stored] = redactGoogleToolPartsForPersistence([{
        type: `tool-${GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME}`,
        toolCallId: 'call-1',
        state: 'output-available',
        input: { name: 'Plan', kind: 'document', content: '# Plan' },
        output: {
          references: [{
            id: 'file-id-0123456789',
            kind: 'drive-file',
            title: 'Plan',
            link: 'https://drive.google.com/open?id=file-id-0123456789',
            parentId: 'parent-id-0123456789',
          }],
          created: true,
          file_id: 'file-id-0123456789',
          message: 'The file was created.',
        },
      }] as never) as unknown as Array<{ output: Record<string, unknown> }>

      expect(Object.keys(stored!.output).sort())
        .toEqual(['bodyRemoved', 'note', 'references'])
      expect(stored!.output.references).toEqual([{
        id: 'file-id-0123456789',
        kind: 'drive-file',
        title: 'Plan',
        link: 'https://drive.google.com/open?id=file-id-0123456789',
        parentId: 'parent-id-0123456789',
      }])
    })

  it('names the file tool in the Drive step titles', () => {
    expect(getGoogleDriveToolStepTitle(
      GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME,
      false,
      false,
    )).toBe('Created a file in Google Drive')
    expect(getGoogleDriveToolStepTitle(
      GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME,
      true,
      false,
    )).toBe('Creating a file in Google Drive')
    expect(getGoogleDriveToolStepTitle(
      GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME,
      false,
      true,
    )).toBe('Creating a file in Google Drive failed')
  })

  it('names every Drive write tool in the Drive step titles', () => {
    expect(getGoogleDriveToolStepTitle(
      GOOGLE_DRIVE_RENAME_TOOL_NAME,
      false,
      false,
    )).toBe('Renamed an item in Google Drive')
    expect(getGoogleDriveToolStepTitle(
      GOOGLE_DRIVE_MOVE_TOOL_NAME,
      false,
      false,
    )).toBe('Moved an item in Google Drive')
    expect(getGoogleDriveToolStepTitle(
      GOOGLE_DRIVE_MOVE_TOOL_NAME,
      true,
      false,
    )).toBe('Moving an item in Google Drive')
    expect(getGoogleDriveToolStepTitle(
      GOOGLE_DRIVE_RENAME_TOOL_NAME,
      false,
      true,
    )).toBe('Renaming an item in Google Drive failed')
  })

  it('names both tools in the Drive step titles', () => {
    expect(GOOGLE_DRIVE_WRITE_TOOL_NAMES.every(isGoogleDriveToolName))
      .toBe(true)
    expect(getGoogleDriveToolStepTitle(
      GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME,
      false,
      false,
    )).toBe('Created a folder in Google Drive')
    expect(getGoogleDriveToolStepTitle(
      GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME,
      false,
      false,
    )).toBe('Listed folders in Google Drive')
    expect(getGoogleDriveToolStepTitle(
      GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME,
      true,
      false,
    )).toBe('Creating a folder in Google Drive')
  })
})
