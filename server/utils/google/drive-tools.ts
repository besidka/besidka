import { tool } from 'ai'
import type { ToolSet } from 'ai'
import type { KVNamespace } from '@cloudflare/workers-types'
import type { RequestEvent } from 'nuxt/server'
import { and, eq } from 'drizzle-orm'
import { createError } from 'evlog'
import { z } from 'zod'
import { buildDriveFileLink, sanitizeDriveFileName } from '#shared/utils/google-drive'
import {
  GOOGLE_DRIVE_FILE_ID_SHAPE,
  GOOGLE_DRIVE_FILE_REFERENCE_KIND,
  GOOGLE_DRIVE_LIST_TOOL_NAME,
  GOOGLE_DRIVE_READ_TEXT_MAX_BYTES,
  GOOGLE_DRIVE_READ_TOOL_NAME,
  GOOGLE_DRIVE_SAVE_FAILURE_STATUS,
  GOOGLE_DRIVE_SAVE_TOOL_NAME,
  GOOGLE_DRIVE_TOOLS_TRUST_NOTE,
} from '#shared/utils/google-drive-tools'
import * as schema from '~~/server/db/schema'
import { quoteText } from '~~/server/utils/besidka-tools/summary'
import { frameUntrustedResult } from '~~/server/utils/connectors/tool-definitions'
import { withFollowUpTurn } from '~~/server/utils/ai/tool-loop'
import { truncateToByteBudget } from '~~/server/utils/skills/runtime/text'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { safeFileType } from '~~/server/utils/google/file-type'
import { sanitizeMailText } from '~~/server/utils/google/gmail-text'
import {
  createPickedDriveSendState,
  listPickedDriveFiles,
  readPickedDriveFile,
} from '~~/server/utils/google/drive-picked'
import type { PickedDriveFile } from '~~/server/utils/google/drive-picked'
import { saveFileToGoogleDrive } from '~~/server/utils/google/drive-save'
import { createGoogleSendGuard } from '~~/server/utils/google/send-guard'
import type { GoogleSendGuard } from '~~/server/utils/google/send-guard'
import {
  fitGoogleToolOutput,
  googleToolModelOutput as toModelOutput,
  hashGoogleTool as hashTool,
} from '~~/server/utils/google/tool-output'
import type {
  GoogleToolOutput,
  GoogleToolReference,
} from '~~/server/utils/tool-approval/google'
import type { GoogleSendTools } from '~~/server/utils/tool-approval/google-send-candidates'
import { buildGoogleApprovalEntry } from '~~/server/utils/tool-approval/send'
import type { SendToolEntry } from '~~/server/utils/tool-approval/send'

type DbClient = ReturnType<typeof useDb>

const FRAME_SLUG = 'google'
const FILE_ID_INPUT_MAX = 200
const FILE_NAME_INPUT_MAX = 255
const READ_OFFSET_MAX = 8 * 1024 * 1024
const LIST_TEXT_BUDGET_BYTES = 24 * 1024
const KIBIBYTE = 1024
const MEBIBYTE = KIBIBYTE * KIBIBYTE
const HIGH_SURROGATE_FIRST = 0xd800
const HIGH_SURROGATE_LAST = 0xdbff
const LOW_SURROGATE_FIRST = 0xdc00
const LOW_SURROGATE_LAST = 0xdfff

const WRONG_ID_TEXT = 'is not one of the files the user picked from Google '
  + `Drive. Pass the file_id from ${GOOGLE_DRIVE_LIST_TOOL_NAME} (a Besidka `
  + 'file id), not a Drive link or Drive id.'

const LIST_DESCRIPTION = 'List the files the user picked from Google Drive '
  + 'and copied into Besidka: file_id, name, type, size, when it was copied '
  + 'and when the Drive original last changed. Only picked files exist here: '
  + 'nothing else in Drive can be searched or read. The user is asked before '
  + `this runs. Pass a file_id to ${GOOGLE_DRIVE_READ_TOOL_NAME}. `
  + GOOGLE_DRIVE_TOOLS_TRUST_NOTE

const READ_DESCRIPTION = 'Read the text of ONE file the user picked from '
  + `Google Drive, by the file_id from ${GOOGLE_DRIVE_LIST_TOOL_NAME}. The `
  + 'user is asked before each read unless they allowed reading in this chat. '
  + 'Only picked files can be read. The first page refreshes the copy when '
  + 'the Drive original changed. Text, Markdown, CSV and JSON are returned '
  + '(Docs as Markdown, Sheets as a workbook map of every tab with its '
  + 'values, formulas, dropdowns and rules, or as the first tab in CSV when '
  + 'the Sheets API cannot be read, Slides as text), at most 40 KiB at a '
  + 'time; to continue, call again with the fileId and the '
  + 'offset the answer names, so every page comes from the same version. A '
  + 'PDF, image or Office file is not readable here. '
  + GOOGLE_DRIVE_TOOLS_TRUST_NOTE

const SAVE_DESCRIPTION = 'Save ONE of the user\'s Besidka files to their '
  + 'Google Drive as a new file. The fileId is the id of a Besidka file: the '
  + 'one besidka__create_file or besidka__create_document returned, or a file '
  + 'generated in this chat. It always creates a new Drive file and never '
  + 'overwrites one, saves one file per call, handles files up to 5 MB, and '
  + 'the user is asked to approve every call. Optionally pass the name to '
  + 'give the Drive file. It answers with the Drive link. A file that was '
  + 'saved before answers with its existing link.'

const listInputSchema = z.object({}).strict()

const readInputSchema = z.object({
  fileId: z
    .string()
    .max(FILE_ID_INPUT_MAX)
    .describe(`file_id from ${GOOGLE_DRIVE_LIST_TOOL_NAME}, or the fileId `
      + 'of the earlier page'),
  offset: z
    .number()
    .int()
    .min(0)
    .max(READ_OFFSET_MAX)
    .optional()
    .describe('Character offset to continue from, from the earlier answer'),
}).strict()

const saveInputSchema = z.object({
  fileId: z
    .string()
    .max(FILE_ID_INPUT_MAX)
    .describe('Besidka file id of the file to save'),
  name: z
    .string()
    .trim()
    .min(1)
    .max(FILE_NAME_INPUT_MAX)
    .optional()
    .describe('Name for the Drive file, with its extension. Defaults to '
      + 'the name of the Besidka file'),
}).strict()

export interface GoogleDriveToolsInput {
  db: DbClient
  kv: KVNamespace
  event: Pick<RequestEvent, 'context'>
  userId: number
  chatGrantHashes: Readonly<Record<string, string>>
  priorCalls?: number
  guard?: GoogleSendGuard
  logger: LoggerLike
}

function toolFailure(message: string, status: number) {
  return createError({
    message,
    status,
    why: 'The Google Drive tool could not complete the call.',
    fix: 'Tell the user what happened in plain words.',
  })
}

function referenceOf(file: PickedDriveFile): GoogleToolReference {
  return {
    id: file.driveFileId,
    kind: GOOGLE_DRIVE_FILE_REFERENCE_KIND,
    title: file.name,
    link: buildDriveFileLink(file.driveFileId),
    ...(file.modifiedAt ? { date: file.modifiedAt.toISOString() } : {}),
  }
}

function describeFileLine(file: PickedDriveFile): string {
  return [
    `file_id: ${file.id}`,
    `name: ${file.name}`,
    `type: ${safeFileType(file.type)}`,
    `size: ${file.size} bytes`,
    `copied: ${file.copiedAt.toISOString()}`,
    file.modifiedAt
      ? `changed in Drive: ${file.modifiedAt.toISOString()}`
      : 'changed in Drive: unknown',
  ].join(' | ')
}

function buildListOutput(
  files: readonly PickedDriveFile[],
  textBudgetBytes: number,
): GoogleToolOutput {
  const text = frameUntrustedResult({
    slug: FRAME_SLUG,
    toolName: 'drive_list_picked',
    text: files.map(describeFileLine).join('\n'),
  }).text
  const fits = new TextEncoder().encode(text).byteLength <= textBudgetBytes

  return {
    references: fits ? files.map(referenceOf) : [],
    count: files.length,
    files: fits ? text : '',
    ...(fits
      ? {}
      : {
        note: `There are ${files.length} picked files, too many to list `
          + 'here. Ask the user which one they mean.',
      }),
    ...(files.length === 0
      ? {
        note: 'The user has not picked any Google Drive file yet. They add '
          + 'one from the + menu: Add, Google Drive.',
      }
      : {}),
  }
}

function isHighSurrogate(code: number): boolean {
  return code >= HIGH_SURROGATE_FIRST && code <= HIGH_SURROGATE_LAST
}

function isLowSurrogate(code: number): boolean {
  return code >= LOW_SURROGATE_FIRST && code <= LOW_SURROGATE_LAST
}

function pageStartOf(text: string, offset: number): number {
  if (
    offset > 0
    && offset < text.length
    && isLowSurrogate(text.charCodeAt(offset))
    && isHighSurrogate(text.charCodeAt(offset - 1))
  ) {
    return offset - 1
  }

  return offset
}

const UNSAFE_TEXT_CHARACTERS = /(?![\n\t])[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u

/**
 * The page of a stored copy cleaned the way mail text is (control, format
 * and bidirectional characters removed, tabs and line breaks kept) before it
 * is framed. Paging works on the raw text, so the offsets stay stable; the
 * cleaning only shortens the page that is shown. The test first, because a
 * copy of several megabytes rarely needs it.
 */
function cleanFileText(text: string): string {
  return UNSAFE_TEXT_CHARACTERS.test(text)
    ? sanitizeMailText(text, { keepTabs: true })
    : text
}

const STALE_NOTES = {
  unreachable: 'Google Drive could not be reached to check for changes, so '
    + 'this is the last copy Besidka made. It may be out of date.',
  storage_full: 'The user\'s Besidka storage is full, so a fresh copy could '
    + 'not be made. This is the last copy Besidka made and it may be out of '
    + 'date.',
} as const

function buildReadOutput(input: {
  file: PickedDriveFile
  text: string
  start: number
  staleCause: keyof typeof STALE_NOTES | null
}, textBudgetBytes: number): GoogleToolOutput {
  const content = input.text.slice(input.start)
  const cut = textBudgetBytes > 0
    ? truncateToByteBudget(content, textBudgetBytes)
    : { text: '', isTruncated: content.length > 0 }
  const framed = frameUntrustedResult({
    slug: FRAME_SLUG,
    toolName: 'drive_read_file',
    text: `name: ${input.file.name}\n\n${cleanFileText(cut.text)}`,
  })
  const nextOffset = cut.isTruncated ? input.start + cut.text.length : null

  return {
    references: [referenceOf(input.file)],
    readable: true,
    file: {
      fileId: input.file.id,
      type: safeFileType(input.file.type),
      size: input.file.size,
      totalCharacters: input.text.length,
      ...(input.file.modifiedAt
        ? { changedInDrive: input.file.modifiedAt.toISOString() }
        : {}),
    },
    content: framed.text,
    isTruncated: cut.isTruncated,
    nextOffset,
    ...(input.staleCause ? { note: STALE_NOTES[input.staleCause] } : {}),
    ...(cut.isTruncated
      ? {
        truncationNote: 'The file is longer than fits in one answer. Call '
          + `${GOOGLE_DRIVE_READ_TOOL_NAME} again with fileId `
          + `"${input.file.id}" and offset ${nextOffset} to continue with `
          + 'the same version.',
      }
      : {}),
  }
}

interface OwnedFileInfo {
  name: string
  size: number
  createdAt: Date | null
  isGoogleDerived: boolean
}

async function readOwnedFileInfo(
  db: DbClient,
  userId: number,
  fileId: string,
  onlyDriveCopies: boolean,
): Promise<OwnedFileInfo | null> {
  if (!GOOGLE_DRIVE_FILE_ID_SHAPE.test(fileId)) {
    return null
  }

  const [row] = await db
    .select({
      name: schema.files.name,
      size: schema.files.size,
      createdAt: schema.files.createdAt,
      googleDerivedAt: schema.files.googleDerivedAt,
    })
    .from(schema.files)
    .where(and(
      eq(schema.files.id, fileId),
      eq(schema.files.userId, userId),
      ...(onlyDriveCopies ? [eq(schema.files.externalSource, 'google')] : []),
    ))
    .limit(1)

  return row
    ? {
      name: row.name,
      size: row.size,
      createdAt: row.createdAt,
      isGoogleDerived: !!row.googleDerivedAt,
    }
    : null
}

function asFileId(value: unknown): string | null {
  const fileId = (value as { fileId?: unknown } | null)?.fileId

  return typeof fileId === 'string' ? fileId : null
}

function asName(value: unknown): string | null {
  const name = (value as { name?: unknown } | null)?.name

  return typeof name === 'string' && name.trim() ? name.trim() : null
}

function formatSize(bytes: number): string {
  return bytes >= MEBIBYTE
    ? `${(bytes / MEBIBYTE).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / KIBIBYTE))} KB`
}

function describeEntry(
  entry: SendToolEntry,
  describe: (callInput: unknown) => Promise<string | null>,
): SendToolEntry {
  return { ...entry, describe }
}

/**
 * The three Drive tools of a send with their approval entries: the list and
 * the read (Google reads, which ask with Allow once or Allow in this chat)
 * and the save (a Google write, Allow once only, and no Google content in
 * its answer, so it taints the send only for a Google-derived file). The
 * Drive id of a file always comes from a `files` row of this user, never
 * from the model, and every check that needs no Google runs before the
 * token is read.
 *
 * Calls run one at a time (a per-send chain), and at most
 * `GOOGLE_DRIVE_CALLS_PER_MESSAGE` count for one message across its rounds
 * and approvals (`priorCalls` are the Google calls the reply already
 * holds). Output is references plus, for a read, text framed as untrusted
 * and cut so the whole JSON stays within `GOOGLE_TOOL_OUTPUT_MAX_BYTES`;
 * the model sees the output without its references (`toModelOutput`). A
 * refusal or a Google failure is a thrown, model-readable error, so only
 * real Drive data or a finished save is ever a result.
 */
export async function buildGoogleDriveTools(
  input: GoogleDriveToolsInput,
): Promise<GoogleSendTools> {
  const { db, kv, event, userId, logger } = input
  const priorCalls = input.priorCalls ?? 0
  const sendState = createPickedDriveSendState()
  const hashes = {
    list: await hashTool(
      GOOGLE_DRIVE_LIST_TOOL_NAME,
      LIST_DESCRIPTION,
      listInputSchema,
      'read',
    ),
    read: await hashTool(
      GOOGLE_DRIVE_READ_TOOL_NAME,
      READ_DESCRIPTION,
      readInputSchema,
      'read',
    ),
    save: await hashTool(
      GOOGLE_DRIVE_SAVE_TOOL_NAME,
      SAVE_DESCRIPTION,
      saveInputSchema,
      'write',
    ),
  }
  const { serialized, consumeCall } = input.guard
    ?? createGoogleSendGuard({ priorCalls, logger })

  const listTool = withFollowUpTurn(tool({
    description: LIST_DESCRIPTION,
    inputSchema: listInputSchema,
    toModelOutput,
    execute: () => serialized(async () => {
      consumeCall()

      const files = await listPickedDriveFiles(db, userId)

      logger.set({
        attributes: { googleDriveTools: { listed: files.length } },
      })

      return fitGoogleToolOutput(
        budget => buildListOutput(files, budget),
        LIST_TEXT_BUDGET_BYTES,
      )
    }),
  })) as ToolSet[string]

  const readTool = withFollowUpTurn(tool({
    description: READ_DESCRIPTION,
    inputSchema: readInputSchema,
    toModelOutput,
    execute: callInput => serialized(async () => {
      consumeCall()

      const offset = callInput.offset ?? 0
      const read = await readPickedDriveFile({
        event,
        db,
        kv,
        userId,
        fileId: callInput.fileId,
        offset,
        sendState,
        logger,
      })

      if (read.status === 'not_picked') {
        throw toolFailure(`That file id ${WRONG_ID_TEXT}`, 404)
      }

      if (read.status === 'failed') {
        logger.set({
          attributes: { googleDriveTools: { readFailure: read.code } },
        })

        throw toolFailure(read.message, 502)
      }

      if (read.status === 'not_text') {
        return {
          references: [referenceOf(read.file)],
          readable: false,
          file: { fileId: read.file.id, type: safeFileType(read.file.type) },
          content: frameUntrustedResult({
            slug: FRAME_SLUG,
            toolName: 'drive_read_file',
            text: `name: ${read.file.name}\n`
              + `type: ${safeFileType(read.file.type)}`,
          }).text,
          note: 'This file is not text (a PDF, image or Office file), so '
            + 'it cannot be read here. Ask the user to attach it to a '
            + 'message from the + menu: Add, Google Drive.',
        } satisfies GoogleToolOutput
      }

      const start = pageStartOf(read.text, offset)

      if (start > 0 && start >= read.text.length) {
        throw toolFailure(
          `The offset ${offset} is past the end of this file, which has `
          + `${read.text.length} characters. Start again at offset 0.`,
          400,
        )
      }

      logger.set({
        attributes: {
          googleDriveTools: {
            read: 1,
            readStale: read.staleCause !== null,
            readChars: read.text.length,
          },
        },
      })

      const output = fitGoogleToolOutput(
        budget => buildReadOutput({
          file: read.file,
          text: read.text,
          start,
          staleCause: read.staleCause,
        }, budget),
        GOOGLE_DRIVE_READ_TEXT_MAX_BYTES,
      )

      if (output.isTruncated === true && output.nextOffset === start) {
        throw toolFailure(
          'This part of the file cannot be returned in one answer. Tell the '
          + 'user to open the file in Google Drive.',
          413,
        )
      }

      return output
    }),
  })) as ToolSet[string]

  const saveTool = withFollowUpTurn(tool({
    description: SAVE_DESCRIPTION,
    inputSchema: saveInputSchema,
    toModelOutput,
    execute: callInput => serialized(async () => {
      consumeCall()

      const result = await saveFileToGoogleDrive({
        db,
        kv,
        userId,
        target: { fileId: callInput.fileId },
        ...(callInput.name ? { name: callInput.name } : {}),
        logger,
      })

      if (result.status === 'failed') {
        throw toolFailure(
          result.message,
          GOOGLE_DRIVE_SAVE_FAILURE_STATUS[result.code],
        )
      }

      const { saved } = result

      return {
        references: [{
          id: saved.driveFileId,
          kind: GOOGLE_DRIVE_FILE_REFERENCE_KIND,
          title: saved.name,
          link: saved.link,
        }],
        saved: true,
        alreadySaved: saved.isAlreadySaved,
        link: saved.link,
        message: saved.isAlreadySaved
          ? 'This file was already saved to Google Drive. Nothing new was '
          + 'created.'
          : 'The file was saved to Google Drive as a new file.',
      } satisfies GoogleToolOutput
    }),
  })) as ToolSet[string]

  const approvalInput = { toolApprovalsActive: true }
  const readEntry = (
    toolName: string,
    definitionHash: string,
    summary: string,
  ) => buildGoogleApprovalEntry({
    toolName,
    kind: 'read',
    definitionHash,
    summary,
    chatGrantHash: input.chatGrantHashes[toolName] ?? null,
    ...approvalInput,
  })

  const listEntry = readEntry(
    GOOGLE_DRIVE_LIST_TOOL_NAME,
    hashes.list,
    'List the files you picked from Google Drive',
  )
  const readFileEntry = describeEntry(
    readEntry(
      GOOGLE_DRIVE_READ_TOOL_NAME,
      hashes.read,
      'Read a file you picked from Google Drive',
    ),
    async (callInput) => {
      const fileId = asFileId(callInput)
      const info = fileId
        ? await readOwnedFileInfo(db, userId, fileId, true)
        : null

      return info
        ? `Read ${quoteText(sanitizeDriveFileName(info.name))} from Google Drive`
        : null
    },
  )
  const saveEntry = describeEntry(
    buildGoogleApprovalEntry({
      toolName: GOOGLE_DRIVE_SAVE_TOOL_NAME,
      kind: 'write',
      definitionHash: hashes.save,
      summary: 'Save a file to your Google Drive',
      taintsRun: async (callInput) => {
        const fileId = asFileId(callInput)
        const info = fileId
          ? await readOwnedFileInfo(db, userId, fileId, false)
          : null

        return info === null ? false : info.isGoogleDerived
      },
      ...approvalInput,
    }),
    async (callInput) => {
      const fileId = asFileId(callInput)
      const info = fileId
        ? await readOwnedFileInfo(db, userId, fileId, false)
        : null

      if (!info) {
        return null
      }

      const fileName = sanitizeDriveFileName(info.name)
      const driveName = asName(callInput)
      const details = [
        formatSize(info.size),
        ...(info.createdAt
          ? [`created ${info.createdAt.toISOString().slice(0, 10)}`]
          : []),
      ].join(', ')
      const asClause = driveName && driveName !== fileName
        ? ` as ${quoteText(sanitizeDriveFileName(driveName))}`
        : ''

      return `Save ${quoteText(fileName)} (${details}) to your Google `
        + `Drive${asClause}`
    },
  )

  return {
    tools: {
      [GOOGLE_DRIVE_LIST_TOOL_NAME]: listTool,
      [GOOGLE_DRIVE_READ_TOOL_NAME]: readTool,
      [GOOGLE_DRIVE_SAVE_TOOL_NAME]: saveTool,
    },
    entries: new Map([
      [GOOGLE_DRIVE_LIST_TOOL_NAME, listEntry],
      [GOOGLE_DRIVE_READ_TOOL_NAME, readFileEntry],
      [GOOGLE_DRIVE_SAVE_TOOL_NAME, saveEntry],
    ]),
  }
}
