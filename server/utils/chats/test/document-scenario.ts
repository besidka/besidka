import type { UIMessageChunk } from 'ai'
import { createError } from 'evlog'
import { parseDocumentSpec, summarizeSpec } from '@besidka/doc-renderer/spec'
import type { DocumentSpec } from '@besidka/doc-renderer/spec'
import {
  DOCUMENT_DATA_PART_TYPE,
  DOCUMENT_TOOL_NAME,
} from '#shared/utils/documents'
import type {
  DataDocumentPart,
  DocumentStats,
  DocumentToolOutput,
} from '#shared/utils/documents'
import {
  TEST_DOCUMENT_REPLY,
  TEST_DOCUMENT_SPEC_INPUT,
  TEST_DOCUMENT_TOOL_CALL_ID,
} from '~~/server/utils/chats/test/document-fixture'
import { createDocument } from '~~/server/utils/documents/store'
import * as schema from '~~/server/db/schema'
import { and, desc, eq } from 'drizzle-orm'

type DbClient = ReturnType<typeof useDb>

const TOOL_INPUT_DELAY: number = 400
const TOOL_OUTPUT_DELAY: number = 600
const REPLY_DELAY: number = 300

function readTestDocumentSpec(): DocumentSpec {
  const parsed = parseDocumentSpec(TEST_DOCUMENT_SPEC_INPUT)

  if (!parsed.ok) {
    throw createError({
      message: 'The e2e document fixture is not a valid spec',
      status: 500,
    })
  }

  return parsed.spec
}

function toTestDocumentStats(spec: DocumentSpec): DocumentStats {
  const summary = summarizeSpec(spec)

  return {
    pages: summary.pages,
    slides: summary.slides,
    sheets: summary.sheets,
    cells: summary.cells,
    images: summary.images,
  }
}

export async function createTestDocument(
  db: DbClient,
  userId: number,
): Promise<DocumentToolOutput> {
  const spec = readTestDocumentSpec()
  const stats = toTestDocumentStats(spec)
  const row = await createDocument(db, {
    userId,
    format: spec.format,
    title: spec.title,
    createdVia: 'chat',
    originMessagePublicId: null,
    originProvider: null,
    originModel: null,
    specVersion: spec.specVersion,
    stats,
    specJson: JSON.stringify(spec),
  })

  return {
    documentId: row.id,
    format: spec.format,
    title: spec.title,
    specVersion: spec.specVersion,
    stats,
  }
}

export async function findLatestTestDocumentPart(
  db: DbClient,
  userId: number,
): Promise<DataDocumentPart | null> {
  const [row] = await db.select()
    .from(schema.documents)
    .where(and(
      eq(schema.documents.userId, userId),
      eq(schema.documents.createdVia, 'chat'),
    ))
    .orderBy(desc(schema.documents.id))
    .limit(1)

  if (!row || !row.title || row.specVersion === null) {
    return null
  }

  return {
    type: DOCUMENT_DATA_PART_TYPE,
    data: {
      documentId: row.id,
      format: row.format,
      title: row.title,
      specVersion: row.specVersion,
      status: row.status,
    },
  }
}

export function buildTestDocumentChunks(
  output: DocumentToolOutput,
): { chunk: UIMessageChunk, delay?: number }[] {
  const inputJson = JSON.stringify(TEST_DOCUMENT_SPEC_INPUT)
  const middle = Math.floor(inputJson.length / 2)

  return [
    {
      chunk: {
        type: 'tool-input-start',
        toolCallId: TEST_DOCUMENT_TOOL_CALL_ID,
        toolName: DOCUMENT_TOOL_NAME,
      },
    },
    {
      chunk: {
        type: 'tool-input-delta',
        toolCallId: TEST_DOCUMENT_TOOL_CALL_ID,
        inputTextDelta: inputJson.slice(0, middle),
      },
    },
    {
      chunk: {
        type: 'tool-input-delta',
        toolCallId: TEST_DOCUMENT_TOOL_CALL_ID,
        inputTextDelta: inputJson.slice(middle),
      },
    },
    {
      chunk: {
        type: 'tool-input-available',
        toolCallId: TEST_DOCUMENT_TOOL_CALL_ID,
        toolName: DOCUMENT_TOOL_NAME,
        input: TEST_DOCUMENT_SPEC_INPUT,
      },
      delay: TOOL_INPUT_DELAY,
    },
    {
      chunk: {
        type: 'tool-output-available',
        toolCallId: TEST_DOCUMENT_TOOL_CALL_ID,
        output,
      },
      delay: TOOL_OUTPUT_DELAY,
    },
    { chunk: { type: 'text-start', id: 'test-document-text-0' } },
    {
      chunk: {
        type: 'text-delta',
        id: 'test-document-text-0',
        delta: TEST_DOCUMENT_REPLY,
      },
      delay: REPLY_DELAY,
    },
    { chunk: { type: 'text-end', id: 'test-document-text-0' } },
  ]
}
