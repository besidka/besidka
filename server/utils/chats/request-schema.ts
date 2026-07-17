import { z } from 'zod'

export const chatToolSchema = z.enum([
  'web_search',
  'image_generation',
])

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
