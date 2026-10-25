import { z } from 'zod'
import {
  memoryCategories,
  neverStoreKindIds,
} from '#shared/utils/memory-policy'

export const memoryExtractionOpKinds = ['create', 'update', 'delete'] as const

export const memoryExtractionOpSchema = z.object({
  op: z.enum(memoryExtractionOpKinds),
  category: z.enum(memoryCategories),
  slug: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  body: z.string().nullable(),
  neverStore: z.enum(neverStoreKindIds).nullable(),
  evidence: z.string(),
})

export const memoryExtractionOutputSchema = z.object({
  ops: z.array(memoryExtractionOpSchema),
})

export type MemoryExtractionOp = z.infer<typeof memoryExtractionOpSchema>

export type MemoryExtractionOutput = z.infer<
  typeof memoryExtractionOutputSchema
>
