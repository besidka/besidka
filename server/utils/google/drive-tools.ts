import { tool } from 'ai'
import type { ToolSet } from 'ai'
import type { KVNamespace } from '@cloudflare/workers-types'
import type { RequestEvent } from 'nuxt/server'
import { and, eq } from 'drizzle-orm'
import { createError } from 'evlog'
import { z } from 'zod'
import { buildDriveFileLink } from '#shared/utils/google-drive'
import {
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
import {
  canonicalJson,
  connectorSha256Hex,
  frameUntrustedResult,
} from '~~/server/utils/connectors/tool-definitions'
import { withFollowUpTurn } from '~~/server/utils/ai/tool-loop'
import { truncateToByteBudget } from '~~/server/utils/skills/runtime/text'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  listPickedDriveFiles,
  readPickedDriveFile,
} from '~~/server/utils/google/drive-picked'
import type { PickedDriveFile } from '~~/server/utils/google/drive-picked'
import { saveFileToGoogleDrive } from '~~/server/utils/google/drive-save'
import { fitGoogleToolOutput } from '~~/server/utils/google/tool-output'
import type {
  GoogleToolOutput,
  GoogleToolReference,
} from '~~/server/utils/tool-approval/google'
import type { GoogleSendTools } from '~~/server/utils/tool-approval/google-send-candidates'
import { buildGoogleApprovalEntry } from '~~/server/utils/tool-approval/send'
import type { SendToolEntry } from '~~/server/utils/tool-approval/send'

type DbClient = ReturnType<typeof useDb>

const FRAME_SLUG = 'google'
const BESIDKA_FILE_ID_MAX = 32
const FILE_NAME_INPUT_MAX = 255
const READ_OFFSET_MAX = 8 * 1024 * 1024
const LIST_TEXT_BUDGET_BYTES = 24 * 1024

const LIST_DESCRIPTION = 'List the files the user picked from Google Drive '
  + 'and copied into Besidka: id, name, type, size, when it was copied and '
  + 'when the Drive original last changed. It returns references only, not '
  + 'content, and cannot search Drive or see a file the user did not pick. '
  + `Pass an id to ${GOOGLE_DRIVE_READ_TOOL_NAME} to read one. `
  + GOOGLE_DRIVE_TOOLS_TRUST_NOTE

const READ_DESCRIPTION = 'Read the text of ONE file the user picked from '
  + 'Google Drive, by the id from '
  + `${GOOGLE_DRIVE_LIST_TOOL_NAME}. The copy is refreshed first when the `
  + 'Drive original changed. Text, Markdown and CSV are returned (Docs as '
  + 'Markdown, Sheets as the first sheet in CSV, Slides as text), at most '
  + '40 KiB at a time: pass nextOffset back as offset to continue. A PDF, '
  + 'image or Office file is not readable here. It cannot read any file '
  + 'the user did not pick. '
  + GOOGLE_DRIVE_TOOLS_TRUST_NOTE

const SAVE_DESCRIPTION = 'Save ONE file from the user\'s Besidka files (a '
  + 'document or file made in a chat) to their Google Drive as a new file. '
  + 'It never overwrites a Drive file, saves one file per call, handles '
  + 'files up to 5 MB, and the user is asked to approve every call. Pass '
  + 'the Besidka file id and, optionally, the name to give the Drive file. '
  + 'It answers with the Drive link. A file that was saved before answers '
  + 'with its existing link.'

const listInputSchema = z.object({})

const readInputSchema = z.object({
  fileId: z
    .string()
    .trim()
    .min(1)
    .max(BESIDKA_FILE_ID_MAX)
    .describe(`File id from ${GOOGLE_DRIVE_LIST_TOOL_NAME}`),
  offset: z
    .number()
    .int()
    .min(0)
    .max(READ_OFFSET_MAX)
    .optional()
    .describe('Character offset to continue from, from nextOffset'),
})

const saveInputSchema = z.object({
  fileId: z
    .string()
    .trim()
    .min(1)
    .max(BESIDKA_FILE_ID_MAX)
    .describe('Besidka file id of the file to save'),
  name: z
    .string()
    .trim()
    .min(1)
    .max(FILE_NAME_INPUT_MAX)
    .optional()
    .describe('Name for the Drive file, with its extension. Defaults to '
      + 'the name of the Besidka file'),
})

export interface GoogleDriveToolsInput {
  db: DbClient
  kv: KVNamespace
  event: Pick<RequestEvent, 'context'>
  userId: number
  chatGrantHashes: Readonly<Record<string, string>>
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
  const parts = [
    `id: ${file.id}`,
    `name: ${file.name}`,
    `type: ${file.type}`,
    `size: ${file.size} bytes`,
    `copied: ${file.copiedAt.toISOString()}`,
    file.modifiedAt
      ? `changed in Drive: ${file.modifiedAt.toISOString()}`
      : 'changed in Drive: unknown',
  ]

  return parts.join(' | ')
}

function buildListOutput(
  files: readonly PickedDriveFile[],
  textBudgetBytes: number,
): GoogleToolOutput {
  const lines = files.map(describeFileLine)
  const text = frameUntrustedResult({
    slug: FRAME_SLUG,
    toolName: 'drive_list_picked',
    text: lines.join('\n'),
  }).text
  const fits = new TextEncoder().encode(text).byteLength <= textBudgetBytes
  const shownFiles = fits ? files : files.slice(0, 0)

  return {
    references: shownFiles.map(referenceOf),
    count: files.length,
    ...(fits
      ? { files: text }
      : {
        files: '',
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

function buildReadOutput(input: {
  file: PickedDriveFile
  text: string
  offset: number
  isStale: boolean
}, textBudgetBytes: number): GoogleToolOutput {
  const content = input.text.slice(input.offset)
  const cut = textBudgetBytes > 0
    ? truncateToByteBudget(content, textBudgetBytes)
    : { text: '', isTruncated: content.length > 0 }
  const framed = frameUntrustedResult({
    slug: FRAME_SLUG,
    toolName: 'drive_read_file',
    text: `name: ${input.file.name}\n\n${cut.text}`,
  })

  return {
    references: [referenceOf(input.file)],
    readable: true,
    file: {
      id: input.file.id,
      type: input.file.type,
      size: input.file.size,
      ...(input.file.modifiedAt
        ? { changedInDrive: input.file.modifiedAt.toISOString() }
        : {}),
    },
    content: framed.text,
    isTruncated: cut.isTruncated,
    nextOffset: cut.isTruncated ? input.offset + cut.text.length : null,
    ...(input.isStale
      ? {
        note: 'Google Drive could not be reached to check for changes, so '
          + 'this is the last copy Besidka made. It may be out of date.',
      }
      : {}),
    ...(cut.isTruncated
      ? {
        truncationNote: 'The file is longer than what fits in one answer. '
          + 'Call this tool again with offset set to nextOffset to continue.',
      }
      : {}),
  }
}

async function hashTool(
  name: string,
  description: string,
  schemaOfInput: z.ZodType,
  kind: 'read' | 'write',
): Promise<string> {
  return await connectorSha256Hex(canonicalJson({
    name,
    description,
    inputSchema: z.toJSONSchema(schemaOfInput),
    kind,
  }))
}

async function readOwnedFileName(
  db: DbClient,
  userId: number,
  fileId: string,
  onlyDriveCopies: boolean,
): Promise<string | null> {
  try {
    const [row] = await db
      .select({ name: schema.files.name })
      .from(schema.files)
      .where(and(
        eq(schema.files.id, fileId),
        eq(schema.files.userId, userId),
        ...(onlyDriveCopies ? [eq(schema.files.externalSource, 'google')] : []),
      ))
      .limit(1)

    return row?.name ?? null
  } catch {
    return null
  }
}

function asFileId(value: unknown): string | null {
  const fileId = (value as { fileId?: unknown } | null)?.fileId

  return typeof fileId === 'string' ? fileId : null
}

function asName(value: unknown): string | null {
  const name = (value as { name?: unknown } | null)?.name

  return typeof name === 'string' && name.trim() ? name.trim() : null
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
 * and the save (a Google write, Allow once only). The Drive id of a file
 * always comes from a `files` row of this user, never from the model, and
 * every check that needs no Google runs before the token is read. Output is
 * references plus, for a read, text framed as untrusted and cut so the
 * whole JSON stays within `GOOGLE_TOOL_OUTPUT_MAX_BYTES`. A refusal or a
 * Google failure is a thrown, model-readable error, so only real Drive data
 * or a finished save is ever a result (and so flags the chat).
 */
export async function buildGoogleDriveTools(
  input: GoogleDriveToolsInput,
): Promise<GoogleSendTools> {
  const { db, kv, event, userId, logger } = input
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

  const listTool = withFollowUpTurn(tool({
    description: LIST_DESCRIPTION,
    inputSchema: listInputSchema,
    execute: async () => {
      const files = await listPickedDriveFiles(db, userId)

      logger.set({
        attributes: { googleDriveTools: { listed: files.length } },
      })

      return fitGoogleToolOutput(
        budget => buildListOutput(files, budget),
        LIST_TEXT_BUDGET_BYTES,
      )
    },
  })) as ToolSet[string]

  const readTool = withFollowUpTurn(tool({
    description: READ_DESCRIPTION,
    inputSchema: readInputSchema,
    execute: async (callInput) => {
      const read = await readPickedDriveFile({
        event,
        db,
        kv,
        userId,
        fileId: callInput.fileId,
        logger,
      })

      if (read.status === 'not_picked') {
        throw toolFailure(
          `"${callInput.fileId.slice(0, BESIDKA_FILE_ID_MAX)}" is not one of `
          + `the files the user picked from Google Drive. Call `
          + `${GOOGLE_DRIVE_LIST_TOOL_NAME} to find one.`,
          404,
        )
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
          file: { id: read.file.id, type: read.file.type },
          note: 'This file is not text (a PDF, image or Office file), so '
            + 'it cannot be read here. Ask the user to attach it to a '
            + 'message from the + menu: Add, Google Drive.',
        } satisfies GoogleToolOutput
      }

      logger.set({
        attributes: {
          googleDriveTools: {
            read: 1,
            readStale: read.isStale,
            readChars: read.text.length,
          },
        },
      })

      return fitGoogleToolOutput(
        budget => buildReadOutput({
          file: read.file,
          text: read.text,
          offset: callInput.offset ?? 0,
          isStale: read.isStale,
        }, budget),
        GOOGLE_DRIVE_READ_TEXT_MAX_BYTES,
      )
    },
  })) as ToolSet[string]

  const saveTool = withFollowUpTurn(tool({
    description: SAVE_DESCRIPTION,
    inputSchema: saveInputSchema,
    execute: async (callInput) => {
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
    },
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
      const name = fileId
        ? await readOwnedFileName(db, userId, fileId, true)
        : null

      return name ? `Read ${quoteText(name)} from Google Drive` : null
    },
  )
  const saveEntry = describeEntry(
    buildGoogleApprovalEntry({
      toolName: GOOGLE_DRIVE_SAVE_TOOL_NAME,
      kind: 'write',
      definitionHash: hashes.save,
      summary: 'Save a file to your Google Drive',
      ...approvalInput,
    }),
    async (callInput) => {
      const fileId = asFileId(callInput)
      const fileName = fileId
        ? await readOwnedFileName(db, userId, fileId, false)
        : null

      if (!fileName) {
        return null
      }

      const driveName = asName(callInput)

      return driveName && driveName !== fileName
        ? `Save ${quoteText(fileName)} to your Google Drive as `
        + `${quoteText(driveName)}`
        : `Save ${quoteText(fileName)} to your Google Drive`
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
