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

export const MAX_USER_MESSAGE_TEXT_LENGTH = 200_000
export const MAX_USER_MESSAGE_PARTS = 50
export const MAX_USER_MESSAGE_FILE_NAME_LENGTH = 255
export const MAX_USER_MESSAGE_MEDIA_TYPE_LENGTH = 255
export const MAX_USER_MESSAGE_ID_LENGTH = 128
export const MAX_USER_MESSAGE_FILE_URL_LENGTH = 2048

export const userMessagePartSchema = z.union([
  z.object({
    type: z.literal('text'),
    text: z.string().min(1).max(MAX_USER_MESSAGE_TEXT_LENGTH),
  }).strict(),
  z.object({
    type: z.literal('file'),
    mediaType: z.string().min(1).max(MAX_USER_MESSAGE_MEDIA_TYPE_LENGTH),
    filename: z.string().max(MAX_USER_MESSAGE_FILE_NAME_LENGTH).optional(),
    url: z.string().min(1).max(MAX_USER_MESSAGE_FILE_URL_LENGTH),
  }).strict(),
])

export const userMessagePartsSchema = z
  .array(userMessagePartSchema)
  .nonempty()
  .max(MAX_USER_MESSAGE_PARTS)
  .refine((parts) => {
    return parts.some(part => part.type === 'text')
  })
  .refine((parts) => {
    const totalTextLength = parts.reduce((total, part) => {
      return part.type === 'text' ? total + part.text.length : total
    }, 0)

    return totalTextLength <= MAX_USER_MESSAGE_TEXT_LENGTH
  }, {
    message: 'The combined text of all parts is too long.',
  })

export const incomingUserMessageSchema = z.object({
  id: z.string().nonempty().max(MAX_USER_MESSAGE_ID_LENGTH),
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
