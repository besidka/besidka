import { describe, expect, it } from 'vitest'
import {
  GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME,
  GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME,
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

  it('asks for a folder with Allow once only, whatever grant, mode or '
    + 'taint', () => {
    for (const permissionMode of ['ask', 'allow'] as const) {
      const decision = resolveToolApproval({
        descriptor: descriptor(GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME, WRITE),
        state: recordTaint(createApprovalState(), 'google'),
        permissionMode,
        alwaysGrant: grant(GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME),
        chatGrant: grant(GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME),
      })

      expect(decision.reason).toBe('always-ask')
      expect(decision.status.type).toBe('user-approval')
      expect(decision.rememberOptions).toEqual(['once'])
    }
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
