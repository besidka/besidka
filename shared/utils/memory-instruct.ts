import { z } from 'zod'
import { memoryCategories } from '#shared/utils/memory-policy'

export const MEMORY_INSTRUCT_LIMITS = {
  maxTextChars: 4000,
  maxOperations: 20,
  maxTitleChars: 200,
  maxDescriptionChars: 400,
  maxBodyChars: 8192,
  maxIdChars: 64,
  maxTimestampChars: 40,
  maxReasonChars: 200,
} as const

const projectIdField = z.string().min(1).max(MEMORY_INSTRUCT_LIMITS.maxIdChars)

const entryIdField = z.string().min(1).max(MEMORY_INSTRUCT_LIMITS.maxIdChars)

const updatedAtField = z
  .string()
  .min(1)
  .max(MEMORY_INSTRUCT_LIMITS.maxTimestampChars)
  .refine(value => !Number.isNaN(Date.parse(value)), {
    message: 'updatedAt must be a timestamp',
  })

const titleField = z.string().max(MEMORY_INSTRUCT_LIMITS.maxTitleChars)

const descriptionField = z
  .string()
  .max(MEMORY_INSTRUCT_LIMITS.maxDescriptionChars)

const bodyField = z.string().max(MEMORY_INSTRUCT_LIMITS.maxBodyChars)

export const memoryInstructPreviewBodySchema = z.object({
  text: z
    .string()
    .max(MEMORY_INSTRUCT_LIMITS.maxTextChars)
    .refine(text => text.trim() !== '', { message: 'Text is required' }),
  projectId: projectIdField.nullable().optional(),
})

export const memoryInstructApplyOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create'),
    category: z.enum(memoryCategories),
    title: titleField,
    description: descriptionField,
    body: bodyField,
  }),
  z.object({
    kind: z.literal('update'),
    id: entryIdField,
    updatedAt: updatedAtField,
    title: titleField,
    description: descriptionField,
    body: bodyField,
  }),
  z.object({
    kind: z.literal('delete'),
    id: entryIdField,
    updatedAt: updatedAtField,
  }),
])

export const memoryInstructApplyBodySchema = z.object({
  projectId: projectIdField.nullable().optional(),
  operations: z
    .array(memoryInstructApplyOperationSchema)
    .min(1)
    .max(MEMORY_INSTRUCT_LIMITS.maxOperations),
})

export type MemoryInstructApplyOperation = z.infer<
  typeof memoryInstructApplyOperationSchema
>

export type MemoryInstructApplyBody = z.infer<
  typeof memoryInstructApplyBodySchema
>
