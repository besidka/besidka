#!/usr/bin/env node
/* eslint-disable no-console */

import { readFile } from 'node:fs/promises'
import { ulid } from 'ulid'

const CHAT_COUNT = 100
const PROJECT_COUNT = 20
const MESSAGES_PER_CHAT = 6
const PROJECT_LINKED_CHAT_COUNT = 34
const PINNED_CHAT_COUNT = 10
const PINNED_PROJECT_COUNT = 4
const ARCHIVED_PROJECT_COUNT = 3

const topicDefinitions = [
  {
    title: 'Product roadmap workshop',
    project: 'Product planning',
  },
  {
    title: 'Billing support follow-up',
    project: 'Customer support',
  },
  {
    title: 'Release retro notes',
    project: 'Engineering ops',
  },
  {
    title: 'Marketing launch outline',
    project: 'Marketing',
  },
  {
    title: 'Analytics instrumentation plan',
    project: 'Analytics',
  },
  {
    title: 'Onboarding feedback review',
    project: 'Customer research',
  },
  {
    title: 'Incident response checklist',
    project: 'Operations',
  },
  {
    title: 'Design critique summary',
    project: 'Design review',
  },
  {
    title: 'Sales demo preparation',
    project: 'Sales enablement',
  },
  {
    title: 'Internal knowledge base draft',
    project: 'Documentation',
  },
]

function parseArgs(argv) {
  const args = { _: [] }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]

    if (!value.startsWith('--')) {
      args._.push(value)

      continue
    }

    const key = value.slice(2)
    const next = argv[index + 1]

    if (!next || next.startsWith('--')) {
      args[key] = true

      continue
    }

    args[key] = next
    index += 1
  }

  return args
}

function getRowsFromWranglerJson(value) {
  const rows = []

  function visit(node) {
    if (!node || typeof node !== 'object') {
      return
    }

    if (Array.isArray(node)) {
      node.forEach(visit)

      return
    }

    for (const key of ['results', 'result', 'rows']) {
      const candidate = node[key]

      if (!Array.isArray(candidate)) {
        continue
      }

      for (const row of candidate) {
        if (row && typeof row === 'object' && !Array.isArray(row)) {
          rows.push(row)
        }
      }
    }

    for (const nested of Object.values(node)) {
      visit(nested)
    }
  }

  visit(value)

  return rows
}

async function readJsonRows(inputPath) {
  const raw = await readFile(inputPath, 'utf8')
  const parsed = JSON.parse(raw)

  return getRowsFromWranglerJson(parsed)
}

function printUsage() {
  console.error(`Usage:
  node scripts/seed-chats.mjs resolve-user --input <json> --email <email>
  node scripts/seed-chats.mjs read-max-id --input <json>
  node scripts/seed-chats.mjs generate-cleanup-statements --user-id <id>
  node scripts/seed-chats.mjs generate-sql --email <email> --user-id <id> --chat-start-id <id> --project-start-id <id> --message-start-id <id>`)
}

function escapeSql(value) {
  return String(value).replace(/'/g, '\'\'')
}

function toSqlString(value) {
  return `'${escapeSql(value)}'`
}

function toSqlTimestamp(value) {
  return `${value}`
}

function toSqlNullableTimestamp(value) {
  if (value === null) {
    return 'NULL'
  }

  return `${value}`
}

function toSqlNullableInteger(value) {
  if (value === null) {
    return 'NULL'
  }

  return `${value}`
}

function toTextParts(text) {
  return JSON.stringify([
    {
      type: 'text',
      text,
    },
  ])
}

function buildUserMessage(topic, chatIndex, stepIndex) {
  const paragraphOne = `I am preparing notes for ${topic.title.toLowerCase()} and I want this version to feel realistic enough for a demo account. The current thread should sound like a person thinking through tradeoffs, not like a placeholder sentence.`
  const paragraphTwo = `For step ${stepIndex + 1}, please treat this as a concrete request from a teammate who is balancing urgency, scope, and communication quality. I also want the wording to be long enough that history search can match meaningful fragments later.`

  if (stepIndex === 0) {
    return `${paragraphOne} ${paragraphTwo} I am especially interested in the first-pass framing for chat ${chatIndex + 1}.`
  }

  if (stepIndex === 1) {
    return `${paragraphOne} ${paragraphTwo} Please help me refine the middle of the discussion so it sounds like an active back-and-forth rather than a one-shot prompt.`
  }

  return `${paragraphOne} ${paragraphTwo} Finish with recommendations that would make sense to revisit from history or inside a project later.`
}

function buildAssistantMessage(topic, chatIndex, stepIndex) {
  const paragraphOne = `Here is a fuller response for ${topic.title.toLowerCase()} that reads like an actual assistant answer instead of a synthetic test stub. I will keep the tone practical, explain the tradeoffs in complete sentences, and include enough detail that the resulting message is useful in a demo conversation.`
  const paragraphTwo = `For chat ${chatIndex + 1}, this section expands on step ${stepIndex + 1} by spelling out why a recommendation exists, what risks it avoids, and what a sensible next action would be. That makes the seeded thread feel more believable when someone opens it from history.`
  const paragraphThree = `If you revisit this conversation later, the main idea should still be clear: define the objective, reduce unnecessary scope, capture the decision in plain language, and leave a short path for follow-up. That pattern gives the seeded data enough structure to support search, pinning, and project-based demos.`

  return `${paragraphOne} ${paragraphTwo} ${paragraphThree}`
}

function buildActivityTimestamps() {
  const now = new Date()
  const timestamps = []

  for (let index = 0; index < 12; index += 1) {
    timestamps.push(offsetDate(now, 0, index * 47 + 15))
  }

  for (let index = 0; index < 10; index += 1) {
    timestamps.push(offsetDate(now, 1, index * 53 + 20))
  }

  for (let index = 0; index < 24; index += 1) {
    timestamps.push(offsetDate(now, 2 + (index % 6), index * 19 + 10))
  }

  for (let index = 0; index < 28; index += 1) {
    timestamps.push(offsetDate(now, 32 + (index % 28), index * 13 + 5))
  }

  for (let index = 0; index < 26; index += 1) {
    timestamps.push(offsetDate(now, 60 + (index % 91), index * 11 + 7))
  }

  return timestamps.slice(0, CHAT_COUNT)
}

function offsetDate(reference, daysAgo, minutesOffset) {
  const value = new Date(reference)

  value.setUTCSeconds(0, 0)
  value.setUTCMinutes(value.getUTCMinutes() - minutesOffset)
  value.setUTCDate(value.getUTCDate() - daysAgo)

  return value
}

function toEpoch(date) {
  return Math.floor(date.getTime() / 1000)
}

function createProjectDistribution() {
  return Array.from({ length: PROJECT_COUNT }, (_, index) => {
    return index < 14 ? 2 : 1
  })
}

function createPinnedIndices(count, total) {
  const result = new Set()
  let current = 0

  while (result.size < count) {
    result.add(current % total)
    current += 9
  }

  return result
}

function buildSeedData(options) {
  const {
    email,
    userId,
    chatStartId,
    projectStartId,
    messageStartId,
  } = options
  const activityDates = buildActivityTimestamps()
  const projectDistribution = createProjectDistribution()
  const pinnedChatIndices = createPinnedIndices(PINNED_CHAT_COUNT, CHAT_COUNT)
  const projects = []
  const chats = []
  const messages = []
  let nextMessageId = messageStartId

  for (let index = 0; index < PROJECT_COUNT; index += 1) {
    const topic = topicDefinitions[index % topicDefinitions.length]
    const projectName = `${topic.project} ${index + 1}`

    projects.push({
      id: projectStartId + index,
      userId,
      name: projectName,
      createdAt: 0,
      updatedAt: 0,
      activityAt: 0,
      pinnedAt: index < PINNED_PROJECT_COUNT ? 0 : null,
      archivedAt: index >= PINNED_PROJECT_COUNT
        && index < PINNED_PROJECT_COUNT + ARCHIVED_PROJECT_COUNT
        ? 0
        : null,
      assignedChatIndices: [],
    })
  }

  for (let index = 0; index < CHAT_COUNT; index += 1) {
    const topic = topicDefinitions[index % topicDefinitions.length]
    const activityDate = activityDates[index]
    const createdAt = new Date(activityDate.getTime() - (4 * 60 * 60 * 1000))
    const updatedAt = activityDate
    let projectId = null

    if (index < PROJECT_LINKED_CHAT_COUNT) {
      const projectIndex = projects.findIndex((project, distributionIndex) => {
        return project.assignedChatIndices.length
          < projectDistribution[distributionIndex]
      })
      const safeProjectIndex = projectIndex === -1 ? 0 : projectIndex
      const targetProject = projects[safeProjectIndex]

      projectId = targetProject.id
      targetProject.assignedChatIndices.push(index)
    }

    const chat = {
      id: chatStartId + index,
      slug: ulid(),
      userId,
      title: `${topic.title} ${index + 1}`,
      createdAt,
      updatedAt,
      activityAt: updatedAt,
      pinnedAt: pinnedChatIndices.has(index)
        ? new Date(updatedAt.getTime() - (30 * 60 * 1000))
        : null,
      projectId,
    }

    chats.push(chat)

    for (let stepIndex = 0; stepIndex < MESSAGES_PER_CHAT / 2; stepIndex += 1) {
      const userMessageDate = new Date(createdAt.getTime()
        + ((stepIndex * 2) * 12 * 60 * 1000))
      const assistantMessageDate = new Date(createdAt.getTime()
        + (((stepIndex * 2) + 1) * 12 * 60 * 1000))

      messages.push({
        id: nextMessageId,
        chatId: chat.id,
        role: 'user',
        parts: toTextParts(buildUserMessage(topic, index, stepIndex)),
        tools: '[]',
        reasoning: 'off',
        createdAt: userMessageDate,
        updatedAt: userMessageDate,
      })
      nextMessageId += 1

      messages.push({
        id: nextMessageId,
        chatId: chat.id,
        role: 'assistant',
        parts: toTextParts(buildAssistantMessage(topic, index, stepIndex)),
        tools: '[]',
        reasoning: 'off',
        createdAt: assistantMessageDate,
        updatedAt: assistantMessageDate,
      })
      nextMessageId += 1
    }
  }

  for (const project of projects) {
    const assignedChats = chats.filter((chat) => {
      return chat.projectId === project.id
    })
    const latestActivity = assignedChats
      .map(chat => chat.activityAt)
      .sort((left, right) => right.getTime() - left.getTime())[0]
    const createdAt = assignedChats
      .map(chat => chat.createdAt)
      .sort((left, right) => left.getTime() - right.getTime())[0]
      || new Date()

    project.createdAt = toEpoch(createdAt)
    project.updatedAt = latestActivity
      ? toEpoch(latestActivity)
      : toEpoch(createdAt)
    project.activityAt = latestActivity
      ? toEpoch(latestActivity)
      : toEpoch(createdAt)

    if (project.pinnedAt !== null) {
      project.pinnedAt = project.updatedAt - 900
    }

    if (project.archivedAt !== null) {
      project.archivedAt = project.updatedAt - 1800
    }
  }

  return {
    email,
    userId,
    projects,
    chats,
    messages,
  }
}

function buildSql(seedData) {
  const statements = [
    ...buildCleanupStatements(seedData.userId),
  ]

  for (const project of seedData.projects) {
    statements.push(
      `INSERT INTO projects (id, created_at, updated_at, user_id, name, instructions, memory, memory_status, memory_updated_at, memory_dirty_at, memory_provider, memory_model, memory_error, pinned_at, archived_at, activity_at) VALUES (${project.id}, ${toSqlTimestamp(project.createdAt)}, ${toSqlTimestamp(project.updatedAt)}, ${project.userId}, ${toSqlString(project.name)}, NULL, NULL, 'idle', NULL, NULL, NULL, NULL, NULL, ${toSqlNullableTimestamp(project.pinnedAt)}, ${toSqlNullableTimestamp(project.archivedAt)}, ${toSqlTimestamp(project.activityAt)});`,
    )
  }

  for (const chat of seedData.chats) {
    statements.push(
      `INSERT INTO chats (id, created_at, updated_at, slug, user_id, title, shared, pinned_at, project_id, project_memory_summary, project_memory_summary_updated_at, activity_at) VALUES (${chat.id}, ${toSqlTimestamp(toEpoch(chat.createdAt))}, ${toSqlTimestamp(toEpoch(chat.updatedAt))}, ${toSqlString(chat.slug)}, ${chat.userId}, ${toSqlString(chat.title)}, NULL, ${toSqlNullableTimestamp(chat.pinnedAt ? toEpoch(chat.pinnedAt) : null)}, ${toSqlNullableInteger(chat.projectId)}, NULL, NULL, ${toSqlTimestamp(toEpoch(chat.activityAt))});`,
    )
  }

  for (const message of seedData.messages) {
    statements.push(
      `INSERT INTO messages (id, created_at, updated_at, chat_id, role, parts, tools, reasoning) VALUES (${message.id}, ${toSqlTimestamp(toEpoch(message.createdAt))}, ${toSqlTimestamp(toEpoch(message.updatedAt))}, ${message.chatId}, ${toSqlString(message.role)}, ${toSqlString(message.parts)}, ${toSqlString(message.tools)}, ${toSqlString(message.reasoning)});`,
    )
  }

  return `${statements.join('\n')}\n`
}

function buildCleanupStatements(userId) {
  return [
    `DELETE FROM chats WHERE user_id = ${userId};`,
    `DELETE FROM projects WHERE user_id = ${userId};`,
  ]
}

function generateCleanupStatements(args) {
  const statements = buildCleanupStatements(Number(args['user-id']))

  process.stdout.write(statements.join('\n') + '\n')
}

async function resolveUser(args) {
  const rows = await readJsonRows(args.input)
  const user = rows.find((row) => {
    return String(row.email || '').toLowerCase() === args.email.toLowerCase()
  })

  if (!user || typeof user.id !== 'number') {
    console.error(`No existing user found for ${args.email}`)
    process.exit(1)
  }

  process.stdout.write(JSON.stringify({
    id: user.id,
    email: user.email,
    name: user.name || null,
  }))
}

async function readMaxId(args) {
  const rows = await readJsonRows(args.input)
  const values = rows.flatMap((row) => {
    return ['max_id', 'maxId', 'id']
      .map(key => row[key])
      .filter(value => typeof value === 'number')
  })
  const result = values.length > 0 ? Math.max(...values) : 0

  process.stdout.write(`${result}\n`)
}

function generateSql(args) {
  const seedData = buildSeedData({
    email: args.email,
    userId: Number(args['user-id']),
    chatStartId: Number(args['chat-start-id']),
    projectStartId: Number(args['project-start-id']),
    messageStartId: Number(args['message-start-id']),
  })
  const sql = buildSql(seedData)

  process.stdout.write(sql)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0]

  switch (command) {
    case 'resolve-user':
      if (!args.input || !args.email) {
        printUsage()
        process.exit(1)
      }

      await resolveUser(args)
      break
    case 'read-max-id':
      if (!args.input) {
        printUsage()
        process.exit(1)
      }

      await readMaxId(args)
      break
    case 'generate-sql':
      if (
        !args.email
        || !args['user-id']
        || !args['chat-start-id']
        || !args['project-start-id']
        || !args['message-start-id']
      ) {
        printUsage()
        process.exit(1)
      }

      generateSql(args)
      break
    case 'generate-cleanup-statements':
      if (!args['user-id']) {
        printUsage()
        process.exit(1)
      }

      generateCleanupStatements(args)
      break
    default:
      printUsage()
      process.exit(1)
  }
}

await main()
