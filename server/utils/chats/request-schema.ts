import { z } from 'zod'
import { isWebSearchTool } from '#shared/utils/message-metadata'
import { MAX_USER_MESSAGE_TEXT_LENGTH } from '#shared/utils/chat-message-limits'
import {
  ARTIFACT_ATTACHMENTS_MAX,
  ARTIFACT_ATTACHMENT_PART_TYPE,
  ARTIFACT_KINDS,
  ARTIFACT_TITLE_MAX,
} from '#shared/utils/artifacts'
import {
  SKILL_INVOCATIONS_PER_MESSAGE,
  SKILL_NAME_MAX,
} from '#shared/utils/skills-policy'
import { SKILL_INVOCATION_PART_TYPE } from '#shared/utils/skills/runtime'

export const chatToolSchema = z.enum([
  'web_search',
  'web_search_brave',
  'web_search_exa',
  'image_generation',
  'code_execution',
])

export const chatToolsSchema = z.array(chatToolSchema)
  .refine(tools => tools.filter(isWebSearchTool).length <= 1, {
    message: 'Only one web search provider may be selected per message.',
  })
  .refine(tools => !(tools.some(isWebSearchTool)
    && tools.includes('image_generation')), {
    message: 'Web search and image generation cannot be combined.',
  })
  .refine(tools => !(tools.includes('code_execution')
    && tools.includes('image_generation')), {
    message: 'Code execution and image generation cannot be combined.',
  })

export const MAX_USER_MESSAGE_PARTS = 50
export const MAX_USER_MESSAGE_FILE_NAME_LENGTH = 255
export const MAX_USER_MESSAGE_MEDIA_TYPE_LENGTH = 255
export const MAX_USER_MESSAGE_ID_LENGTH = 128
export const MAX_USER_MESSAGE_FILE_URL_LENGTH = 2048
export const MAX_USER_MESSAGE_ARTIFACT_ID_LENGTH = 64
export const MAX_USER_MESSAGE_SKILL_ID_LENGTH = 64

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
  z.object({
    type: z.literal(ARTIFACT_ATTACHMENT_PART_TYPE),
    data: z.object({
      artifactId: z.string().min(1).max(MAX_USER_MESSAGE_ARTIFACT_ID_LENGTH),
      version: z.number().int().min(1),
      kind: z.enum(ARTIFACT_KINDS),
      title: z.string().max(ARTIFACT_TITLE_MAX),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal(SKILL_INVOCATION_PART_TYPE),
    data: z.object({
      skillId: z.string().min(1).max(MAX_USER_MESSAGE_SKILL_ID_LENGTH),
      name: z.string().max(SKILL_NAME_MAX),
      version: z.number().int().min(1),
    }).strict(),
  }).strict(),
])

export const userMessagePartsSchema = z
  .array(userMessagePartSchema)
  .nonempty()
  .max(MAX_USER_MESSAGE_PARTS)
  .refine((parts) => {
    return parts.some((part) => {
      return part.type === 'text' || part.type === SKILL_INVOCATION_PART_TYPE
    })
  }, {
    message: 'A message needs text or an attached skill.',
  })
  .refine((parts) => {
    return parts.filter((part) => {
      return part.type === SKILL_INVOCATION_PART_TYPE
    }).length <= SKILL_INVOCATIONS_PER_MESSAGE
  }, {
    message: 'A message can attach one skill.',
  })
  .refine((parts) => {
    const artifactIds = parts.flatMap((part) => {
      return part.type === ARTIFACT_ATTACHMENT_PART_TYPE
        ? [part.data.artifactId]
        : []
    })

    return artifactIds.length <= ARTIFACT_ATTACHMENTS_MAX
      && new Set(artifactIds).size === artifactIds.length
  }, {
    message: `A message can attach up to ${ARTIFACT_ATTACHMENTS_MAX} different artifacts.`,
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
