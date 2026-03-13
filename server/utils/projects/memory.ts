import type { LanguageModel, UIMessage } from 'ai'
import type { ProjectMemoryStatus } from '#shared/types/projects.d'
import { and, eq } from 'drizzle-orm'
import { generateText } from 'ai'
import { createError } from 'evlog'
import { providers } from '~~/providers'
import * as schema from '~~/server/db/schema'

interface ProjectMemoryModelSelection {
  providerId: 'google' | 'openai'
  modelId: string
  modelName: string
}

type DbClient = ReturnType<typeof useDb>

type ProjectMemoryTarget = Pick<
  typeof schema.projects.$inferSelect,
  'id'
  | 'userId'
  | 'name'
  | 'memory'
  | 'memoryStatus'
  | 'memoryUpdatedAt'
  | 'memoryDirtyAt'
  | 'memoryProvider'
  | 'memoryModel'
  | 'memoryError'
>

type ProjectMemoryChat = Pick<
  typeof schema.chats.$inferSelect,
  'id'
  | 'projectId'
  | 'projectMemorySummary'
  | 'projectMemorySummaryUpdatedAt'
> & {
  messages: Array<
    Pick<typeof schema.messages.$inferSelect, 'role' | 'parts' | 'createdAt'>
  >
}

export async function resolveProjectMemoryModel(
  userId: number,
  db: DbClient = useDb(),
): Promise<ProjectMemoryModelSelection | null> {
  const savedKeys = await db.query.keys.findMany({
    where(keys, { eq }) {
      return eq(keys.userId, userId)
    },
    columns: {
      provider: true,
    },
  })

  const availableProviders = new Set<string>(
    savedKeys.map(key => key.provider),
  )

  for (const provider of providers) {
    if (!availableProviders.has(provider.id)) {
      continue
    }

    const memoryModel = provider.models.find((model) => {
      return model.forProjectMemory
    })

    if (!memoryModel) {
      continue
    }

    return {
      providerId: provider.id as 'google' | 'openai',
      modelId: memoryModel.id,
      modelName: memoryModel.name,
    }
  }

  return null
}

export async function markProjectsMemoryStale(
  projectIds: Array<string | null | undefined>,
  userId: number,
  db: DbClient = useDb(),
) {
  const uniqueProjectIds = [...new Set(projectIds)].filter(
    (projectId): projectId is string => {
      return projectId !== null && projectId !== undefined
    },
  )

  if (!uniqueProjectIds.length) {
    return
  }

  const memoryDirtyAt = new Date()

  for (const projectId of uniqueProjectIds) {
    await db.update(schema.projects)
      .set({
        memoryStatus: 'stale',
        memoryDirtyAt,
        memoryError: null,
      })
      .where(and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ))
  }
}

export async function refreshProjectMemory(
  projectId: string,
  userId: number,
  db: DbClient = useDb(),
) {
  const project = await db.query.projects.findFirst({
    where(projects, { and, eq }) {
      return and(
        eq(projects.id, projectId),
        eq(projects.userId, userId),
      )
    },
    columns: {
      id: true,
      userId: true,
      name: true,
      memory: true,
      memoryStatus: true,
      memoryUpdatedAt: true,
      memoryDirtyAt: true,
      memoryProvider: true,
      memoryModel: true,
      memoryError: true,
    },
  })

  if (!project) {
    throw createError({
      message: 'Project not found',
      status: 404,
    })
  }

  if (project.memoryStatus === 'refreshing') {
    return await getProjectMemoryState(project.id, userId, db)
  }

  const selection = await resolveProjectMemoryModel(userId, db)

  if (!selection) {
    await updateProjectMemoryState(project, {
      memoryStatus: 'unavailable',
      memoryDirtyAt: new Date(),
      memoryProvider: null,
      memoryModel: null,
      memoryError: 'No saved API key is available for project memory.',
    }, db)

    return await getProjectMemoryState(project.id, userId, db)
  }

  await updateProjectMemoryState(project, {
    memoryStatus: 'refreshing',
    memoryProvider: selection.providerId,
    memoryModel: selection.modelId,
    memoryError: null,
  }, db)

  try {
    const model = await getProjectMemoryModelInstance(
      selection.providerId,
      userId.toString(),
      selection.modelId,
    )
    const chats = await db.query.chats.findMany({
      where(chats, { and, eq }) {
        return and(
          eq(chats.userId, userId),
          eq(chats.projectId, project.id),
        )
      },
      columns: {
        id: true,
        projectId: true,
        projectMemorySummary: true,
        projectMemorySummaryUpdatedAt: true,
      },
      with: {
        messages: {
          columns: {
            role: true,
            parts: true,
            createdAt: true,
          },
          orderBy(messages, { asc }) {
            return asc(messages.createdAt)
          },
        },
      },
    })

    const summaries: string[] = []

    for (const chat of chats) {
      const summary = await refreshChatProjectMemorySummary(
        chat,
        model,
        db,
      )

      if (summary) {
        summaries.push(summary)
      }
    }

    const memory = summaries.length
      ? await synthesizeProjectMemory(project.name, summaries, model)
      : null
    const memoryUpdatedAt = new Date()

    await updateProjectMemoryState(project, {
      memory,
      memoryStatus: 'ready',
      memoryUpdatedAt,
      memoryDirtyAt: null,
      memoryProvider: selection.providerId,
      memoryModel: selection.modelId,
      memoryError: null,
    }, db)
  } catch (exception) {
    await updateProjectMemoryState(project, {
      memoryStatus: 'failed',
      memoryDirtyAt: new Date(),
      memoryError: getExceptionMessage(exception),
    }, db)

    throw exception
  }

  return await getProjectMemoryState(project.id, userId, db)
}

async function getProjectMemoryModelInstance(
  providerId: string,
  userId: string,
  modelId: string,
): Promise<LanguageModel> {
  if (providerId === 'google') {
    const { instance } = await useGoogle(userId, modelId, [], 'off')

    return instance
  }

  if (providerId === 'openai') {
    const { instance } = await useOpenAI(userId, modelId, [], 'off')

    return instance
  }

  throw createError({
    message: 'Unsupported project memory provider',
    status: 400,
    why: `Provider ${providerId} is not supported for project memory.`,
  })
}

async function refreshChatProjectMemorySummary(
  chat: ProjectMemoryChat,
  model: LanguageModel,
  db: DbClient,
) {
  const latestMessageCreatedAt = getLatestMessageCreatedAt(chat.messages)

  if (
    chat.projectMemorySummary
    && chat.projectMemorySummaryUpdatedAt
    && latestMessageCreatedAt
    && chat.projectMemorySummaryUpdatedAt >= latestMessageCreatedAt
  ) {
    return chat.projectMemorySummary
  }

  const transcript = toChatTranscript(chat.messages)
  const projectMemorySummaryUpdatedAt = new Date()

  if (!transcript) {
    await db.update(schema.chats)
      .set({
        projectMemorySummary: null,
        projectMemorySummaryUpdatedAt,
      })
      .where(eq(schema.chats.id, chat.id))

    return null
  }

  const { text } = await generateText({
    model,
    messages: [
      {
        role: 'system',
        content: [
          'Summarize only durable project memory from this chat.',
          'Include stable goals, preferences, constraints, decisions, and conventions.',
          'Exclude temporary task status, one-off troubleshooting, and short-lived details.',
          'If nothing durable exists, respond with NONE.',
          'Return plain text only and keep it concise.',
        ].join(' '),
      },
      {
        role: 'user',
        content: transcript,
      },
    ],
  })

  const summary = normalizeMemoryText(text)

  await db.update(schema.chats)
    .set({
      projectMemorySummary: summary,
      projectMemorySummaryUpdatedAt,
    })
    .where(eq(schema.chats.id, chat.id))

  return summary
}

async function synthesizeProjectMemory(
  projectName: string,
  summaries: string[],
  model: LanguageModel,
) {
  const { text } = await generateText({
    model,
    messages: [
      {
        role: 'system',
        content: [
          `You are maintaining durable memory for the project "${projectName}".`,
          'Merge the provided chat summaries into one concise project memory.',
          'Keep only stable goals, preferences, constraints, decisions, and conventions.',
          'Deduplicate aggressively and remove stale or temporary details.',
          'If there is no durable memory, respond with NONE.',
          'Return plain text only.',
        ].join(' '),
      },
      {
        role: 'user',
        content: summaries
          .map((summary, index) => {
            return `Summary ${index + 1}:\n${summary}`
          })
          .join('\n\n'),
      },
    ],
  })

  return normalizeMemoryText(text)
}

async function updateProjectMemoryState(
  project: ProjectMemoryTarget,
  values: Partial<typeof schema.projects.$inferInsert> & {
    memoryStatus?: ProjectMemoryStatus
  },
  db: DbClient,
) {
  await db.update(schema.projects)
    .set(values)
    .where(and(
      eq(schema.projects.id, project.id),
      eq(schema.projects.userId, project.userId),
    ))
}

async function getProjectMemoryState(
  projectId: string,
  userId: number,
  db: DbClient,
) {
  return await db.query.projects.findFirst({
    where(projects, { and, eq }) {
      return and(
        eq(projects.id, projectId),
        eq(projects.userId, userId),
      )
    },
    columns: {
      id: true,
      memory: true,
      memoryStatus: true,
      memoryUpdatedAt: true,
      memoryDirtyAt: true,
      memoryProvider: true,
      memoryModel: true,
      memoryError: true,
    },
  })
}

function toChatTranscript(
  messages: ProjectMemoryChat['messages'],
) {
  const lines: string[] = []

  for (const message of messages) {
    const text = toMessageText(message.parts)

    if (!text) {
      continue
    }

    lines.push(`${capitalize(message.role)}: ${text}`)
  }

  return lines.join('\n\n')
}

function getLatestMessageCreatedAt(
  messages: ProjectMemoryChat['messages'],
) {
  let latestMessageCreatedAt: Date | null = null

  for (const message of messages) {
    if (!message.createdAt) {
      continue
    }

    if (
      !latestMessageCreatedAt
      || message.createdAt > latestMessageCreatedAt
    ) {
      latestMessageCreatedAt = message.createdAt
    }
  }

  return latestMessageCreatedAt
}

function toMessageText(parts: UIMessage['parts']) {
  if (!Array.isArray(parts)) {
    return ''
  }

  const values: string[] = []

  for (const part of parts) {
    if (part.type !== 'text' || !part.text?.trim()) {
      continue
    }

    values.push(part.text.trim())
  }

  return values.join('\n')
}

function normalizeMemoryText(text: string) {
  const value = text.trim()

  if (!value || value.toUpperCase() === 'NONE') {
    return null
  }

  return value
}

function capitalize(value: string) {
  if (!value.length) {
    return value
  }

  return `${value[0]?.toUpperCase()}${value.slice(1)}`
}

function getExceptionMessage(exception: unknown) {
  if (exception instanceof Error) {
    return exception.message
  }

  return String(exception)
}
