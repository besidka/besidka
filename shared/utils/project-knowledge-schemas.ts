import { z } from 'zod'
import {
  KNOWLEDGE_LIMITS,
  knowledgeExtractStatuses,
  knowledgeExtractors,
  knowledgeModes,
} from '#shared/utils/project-knowledge-policy'
import {
  KNOWLEDGE_RELATIVE_PATH_PRE_NORMALIZE_MAX_CHARS,
  getKnowledgeRelativePathIssue,
  normalizeKnowledgeRelativePath,
} from '#shared/utils/project-knowledge-path'

const CONTROL_OR_SEPARATOR_PATTERN = /[\p{Cc}\u2028\u2029]/u
const FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]+$/
export const KNOWLEDGE_CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/
const MAX_FOLDER_ID_CHARS = 64
const MAX_EXTRACT_ERROR_CHARS = 64
const MAX_MEDIA_TYPE_CHARS = 100
const MAX_SEARCH_ITEM_IDS = 20
const MAX_TOOL_ITEM_ID_CHARS = 64
const MAX_BATCH_ITEMS = 25

export function knowledgeTextByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function hasNoControlCharacters(value: string): boolean {
  return !CONTROL_OR_SEPARATOR_PATTERN.test(value)
}

function hasNoNulCharacter(value: string): boolean {
  return !value.includes('\u0000')
}

const titleField = z
  .string()
  .trim()
  .min(1)
  .max(KNOWLEDGE_LIMITS.maxTitleChars)
  .refine(hasNoControlCharacters, {
    message: 'Title must be a single line without control characters',
  })

const descriptionField = z
  .string()
  .trim()
  .max(KNOWLEDGE_LIMITS.maxDescriptionChars)
  .refine(hasNoControlCharacters, {
    message: 'Description must be a single line without control characters',
  })
  .nullable()

const extractedTextField = z
  .string()
  .max(KNOWLEDGE_LIMITS.maxItemTextBytes)
  .pipe(
    z.string()
      .refine(
        value => knowledgeTextByteLength(value)
          <= KNOWLEDGE_LIMITS.maxItemTextBytes,
        {
          message: 'Text must be at most '
            + `${KNOWLEDGE_LIMITS.maxItemTextBytes} bytes`,
        },
      )
      .refine(hasNoNulCharacter, {
        message: 'Text must not contain NUL characters',
      }),
  )

const noteBodyField = z
  .string()
  .min(1)
  .max(KNOWLEDGE_LIMITS.maxNoteChars)
  .refine(hasNoNulCharacter, {
    message: 'Body must not contain NUL characters',
  })

const relativePathField = z
  .string()
  .max(KNOWLEDGE_RELATIVE_PATH_PRE_NORMALIZE_MAX_CHARS)
  .transform((value, context) => {
    const normalizedPath = normalizeKnowledgeRelativePath(value)
    const issue = getKnowledgeRelativePathIssue(normalizedPath)

    if (issue) {
      context.addIssue({ code: 'custom', message: issue })

      return z.NEVER
    }

    return normalizedPath
  })

const folderIdField = z
  .string()
  .max(MAX_FOLDER_ID_CHARS)
  .regex(FOLDER_ID_PATTERN)
  .refine(hasNoControlCharacters, {
    message: 'Folder id must not contain control characters',
  })

function requireAtLeastOneKey(value: object): boolean {
  return Object.values(value).some(entry => entry !== undefined)
}

const atLeastOneKeyMessage = {
  message: 'At least one field is required',
}

export const knowledgeContentHashSchema = z
  .string()
  .regex(KNOWLEDGE_CONTENT_HASH_PATTERN)

export const knowledgeModeSchema = z.enum(knowledgeModes)

export const knowledgeModePatchSchema = z.object({
  mode: knowledgeModeSchema.nullable(),
})

export const knowledgeCharCountsSchema = z.object({
  latinChars: z.number().int().nonnegative(),
  cyrillicChars: z.number().int().nonnegative(),
  otherChars: z.number().int().nonnegative(),
})

export const knowledgeNoteCreateSchema = z.object({
  title: titleField,
  body: noteBodyField,
  description: descriptionField.optional(),
})

export const knowledgeNoteUpdateSchema = knowledgeNoteCreateSchema
  .partial()
  .refine(requireAtLeastOneKey, atLeastOneKeyMessage)

export const knowledgeItemPatchSchema = z
  .object({
    description: descriptionField.optional(),
    sendAsNativePdf: z.boolean().optional(),
    pinned: z.boolean().optional(),
  })
  .refine(requireAtLeastOneKey, atLeastOneKeyMessage)

export const knowledgeExtractedTextSchema = z.object({
  text: extractedTextField,
})

export const knowledgeItemCreateSchema = z
  .object({
    fileId: z.string().min(1).nullable().optional(),
    title: titleField.optional(),
    mediaType: z.string().min(1).max(MAX_MEDIA_TYPE_CHARS).optional(),
    relativePath: relativePathField.nullable().optional(),
    folderId: folderIdField.nullable().optional(),
    contentHash: knowledgeContentHashSchema.nullable().optional(),
    extractor: z.enum(knowledgeExtractors)
      .refine(value => value !== 'note', {
        message: 'Extractor must not be "note" for files',
      }),
    extractStatus: z.enum(knowledgeExtractStatuses),
    extractError: z.string().max(MAX_EXTRACT_ERROR_CHARS).nullable().optional(),
    pageCount: z.number()
      .int()
      .min(0)
      .max(KNOWLEDGE_LIMITS.maxPdfPages)
      .nullable()
      .optional(),
    text: extractedTextField,
  })
  .superRefine((value, context) => {
    if (value.extractStatus === 'ready' && value.text.trim().length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'Text is required when the extraction is ready',
      })
    }

    if (value.extractStatus !== 'ready' && value.text.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'Text must be empty unless the extraction is ready',
      })
    }

    if (value.fileId) {
      return
    }

    if (!value.title) {
      context.addIssue({
        code: 'custom',
        path: ['title'],
        message: 'Title is required when there is no original file',
      })
    }

    if (!value.mediaType) {
      context.addIssue({
        code: 'custom',
        path: ['mediaType'],
        message: 'Media type is required when there is no original file',
      })
    }
  })

export const knowledgeItemsBatchCreateSchema = z
  .object({
    items: z.array(knowledgeItemCreateSchema).min(1).max(MAX_BATCH_ITEMS),
    commit: z.boolean().optional(),
  })
  .refine(
    (value) => {
      const totalBytes = value.items.reduce((sum, item) => {
        return sum + knowledgeTextByteLength(item.text)
      }, 0)

      return totalBytes <= KNOWLEDGE_LIMITS.maxBatchTextBytes
    },
    {
      message: 'Batch text must be at most '
        + `${KNOWLEDGE_LIMITS.maxBatchTextBytes} bytes`,
      path: ['items'],
    },
  )

export const knowledgeCommitSchema = z.object({
  folderId: folderIdField.nullable().optional(),
  remove: z.array(z.string().min(1))
    .max(KNOWLEDGE_LIMITS.maxFolderFiles)
    .optional(),
})

export const knowledgePackHeaderSchema = z.object({
  type: z.literal('header'),
  version: z.number().int().nonnegative(),
  builtAt: z.string(),
  items: z.array(z.object({
    itemId: z.string(),
    updatedAt: z.string(),
    chunks: z.number().int().nonnegative(),
  })),
})

export const knowledgePackLineSchema = z.object({
  type: z.literal('chunk'),
  itemId: z.string(),
  ordinal: z.number().int().nonnegative(),
  breadcrumb: z.string(),
  text: z.string(),
})

export const knowledgeSearchToolInputSchema = z.object({
  query: z.string().trim().min(1).max(KNOWLEDGE_LIMITS.searchQueryMaxChars),
  itemIds: z.array(z.string().max(MAX_TOOL_ITEM_ID_CHARS))
    .max(MAX_SEARCH_ITEM_IDS)
    .optional(),
})

export const knowledgeReadToolInputSchema = z.object({
  itemId: z.string().max(MAX_TOOL_ITEM_ID_CHARS),
  fromChunk: z.number().int().nonnegative().optional(),
  count: z.number().int().min(1).max(KNOWLEDGE_LIMITS.readMaxChunks).optional(),
})
