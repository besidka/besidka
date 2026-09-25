import { z } from 'zod'
import { isWebSearchTool } from '#shared/utils/message-metadata'

export const chatToolSchema = z.enum([
  'web_search',
  'web_search_brave',
  'web_search_exa',
  'image_generation',
])

export const chatToolsSchema = z.array(chatToolSchema)
  .refine(tools => tools.filter(isWebSearchTool).length <= 1, {
    message: 'Only one web search provider may be selected per message.',
  })
  .refine(tools => !(tools.some(isWebSearchTool)
    && tools.includes('image_generation')), {
    message: 'Web search and image generation cannot be combined.',
  })

export const userMessagePartSchema = z.union([
  z.object({
    type: z.literal('text'),
    text: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('file'),
    mediaType: z.string().min(1),
    filename: z.string().optional(),
    url: z.string().min(1),
  }).strict(),
])

export const userMessagePartsSchema = z
  .array(userMessagePartSchema)
  .nonempty()
  .refine((parts) => {
    return parts.some(part => part.type === 'text')
  })

export const incomingUserMessageSchema = z.object({
  id: z.string().nonempty(),
  role: z.literal('user'),
  createdAt: z.coerce.date().optional(),
  metadata: z.unknown().optional(),
  annotations: z.array(z.string()).optional(),
  parts: userMessagePartsSchema,
  experimental_attachments: z.array(
    z.object({
      name: z.string().optional(),
      contentType: z.string().optional(),
      url: z.string().nonempty(),
    }).strict(),
  ).optional(),
})
