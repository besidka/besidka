import type {
  ChatContextGroup,
  ChatContextItem,
} from '#shared/types/chat-context.d'
import type { ArtifactKind } from '#shared/utils/artifacts'
import {
  isDataArtifactAttachmentPart,
  isDataArtifactPart,
} from '#shared/utils/artifacts'
import { CODE_EXECUTION_TOOL_NAME } from '#shared/utils/code-execution'
import { isHiddenFilePart } from '#shared/utils/files'
import {
  MEMORY_FORGET_TOOL_NAME,
  MEMORY_LIST_TOOL_NAME,
  MEMORY_READ_TOOL_NAME,
  MEMORY_WRITE_TOOL_NAME,
} from '~~/server/utils/memory/tools/memory-constants'
import {
  READ_CHAT_TOOL_NAME,
  SEARCH_CHATS_TOOL_NAME,
} from '~~/server/utils/memory/tools/constants'
import { PROJECT_KNOWLEDGE_TOOL_NAMES } from '~~/server/utils/ai/knowledge-tools'

export type ChatContextVisibility = 'private' | 'public'

export interface ChatContextMessage {
  id: string
  role: string
  parts: unknown[]
  tools?: unknown
}

export interface ChatContextAccumulator {
  add: (group: ChatContextGroup, item: ChatContextItem) => void
  increment: (
    group: ChatContextGroup,
    item: Omit<ChatContextItem, 'meta'> & { meta?: ChatContextItem['meta'] },
  ) => void
}

export interface ChatContextArtifact {
  title: string
  kind: ArtifactKind
  version: number
  latestVersion: number
}

/**
 * Data a section needs beyond the message parts, loaded once per request
 * before the build: artifacts maps each listable artifact id (owned by the
 * chat owner, not deleted, not taken down) to its row.
 */
export interface ChatContextScope {
  artifacts: ReadonlyMap<string, ChatContextArtifact>
}

/**
 * One block of the chat context panel. A feature that produces or consumes
 * something in a chat adds its own section here (see
 * docs/chats/context-panel.md). `visibility: 'public'` sections also run for
 * shared chats, on the parts a public share exposes.
 */
export interface ChatContextSection {
  id: string
  group: ChatContextGroup
  visibility: ChatContextVisibility
  collect: (
    message: ChatContextMessage,
    accumulator: ChatContextAccumulator,
    scope: ChatContextScope,
  ) => void
}

const TOOL_PART_PREFIX = 'tool-'
const MEMORY_ACTION_LABELS: Record<string, string> = {
  [MEMORY_LIST_TOOL_NAME]: 'Listed',
  [MEMORY_READ_TOOL_NAME]: 'Read',
  [MEMORY_WRITE_TOOL_NAME]: 'Saved',
  [MEMORY_FORGET_TOOL_NAME]: 'Forgot',
}
const WEB_SEARCH_TOOL_LABELS: Record<string, string> = {
  web_search: 'Web search',
  web_search_brave: 'Brave Search',
  web_search_exa: 'Exa search',
}
const TITLE_MAX_LENGTH = 160
const PROVIDER_WEB_SEARCH_TOOL = 'web_search'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function toTitle(value: string): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()

  return singleLine.length > TITLE_MAX_LENGTH
    ? `${singleLine.slice(0, TITLE_MAX_LENGTH - 1)}…`
    : singleLine
}

export function getContextPartToolName(part: unknown): string | null {
  if (!isRecord(part) || typeof part.type !== 'string') {
    return null
  }

  if (part.type === 'dynamic-tool') {
    return readString(part.toolName)
  }

  return part.type.startsWith(TOOL_PART_PREFIX)
    ? part.type.slice(TOOL_PART_PREFIX.length)
    : null
}

function getToolCallId(part: Record<string, unknown>, fallback: string) {
  return readString(part.toolCallId) ?? fallback
}

function getDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function getFileName(part: Record<string, unknown>): string {
  return readString(part.filename) ?? readString(part.name) ?? 'File'
}

const generatedImagesSection: ChatContextSection = {
  id: 'generated-images',
  group: 'outputs',
  visibility: 'public',
  collect(message, accumulator) {
    if (message.role !== 'assistant') {
      return
    }

    for (const part of message.parts) {
      if (!isRecord(part)) {
        continue
      }

      if (getContextPartToolName(part) === 'generate_image') {
        const output = isRecord(part.output) ? part.output : null
        const file = output?.status === 'ready' && isRecord(output.file)
          ? output.file
          : null
        const url = readString(file?.url)

        if (!file || !url) {
          continue
        }

        accumulator.add('outputs', {
          id: `image:${readString(file.id) ?? url}`,
          sectionId: 'generated-images',
          kind: 'image',
          title: toTitle(readString(file.name) ?? 'Generated image'),
          messageId: message.id,
          meta: {
            url,
            downloadUrl: readString(file.downloadUrl) ?? url,
            mediaType: readString(file.type) ?? undefined,
          },
        })

        continue
      }

      if (
        part.type !== 'file'
        || isHiddenFilePart(part as { type: string, mediaType?: string })
      ) {
        continue
      }

      const url = readString(part.url)
      const mediaType = readString(part.mediaType)

      if (!url || !mediaType?.startsWith('image/')) {
        continue
      }

      accumulator.add('outputs', {
        id: `image:${url}`,
        sectionId: 'generated-images',
        kind: 'image',
        title: toTitle(getFileName(part)),
        messageId: message.id,
        meta: { url, downloadUrl: url, mediaType },
      })
    }
  },
}

const researchReportsSection: ChatContextSection = {
  id: 'research-reports',
  group: 'outputs',
  visibility: 'public',
  collect(message, accumulator) {
    for (const part of message.parts) {
      if (!isRecord(part) || part.type !== 'data-research') {
        continue
      }

      const data = isRecord(part.data) ? part.data : {}

      accumulator.add('outputs', {
        id: `research:${message.id}`,
        sectionId: 'research-reports',
        kind: 'research',
        title: 'Research report',
        messageId: message.id,
        meta: {
          provider: readString(data.provider) ?? undefined,
          action: readString(data.level) ?? undefined,
        },
      })
    }
  },
}

const artifactsSection: ChatContextSection = {
  id: 'artifacts',
  group: 'outputs',
  visibility: 'public',
  collect(message, accumulator, scope) {
    for (const part of message.parts) {
      if (!isDataArtifactPart(part)) {
        continue
      }

      const artifact = scope.artifacts.get(part.data.artifactId)

      if (!artifact) {
        continue
      }

      accumulator.add('outputs', {
        id: `artifact:${part.data.artifactId}`,
        sectionId: 'artifacts',
        kind: 'artifact',
        title: toTitle(artifact.title) || 'Artifact',
        messageId: message.id,
        meta: {
          artifactId: part.data.artifactId,
          artifactKind: artifact.kind,
          version: artifact.version,
          latestVersion: artifact.latestVersion,
        },
      })
    }
  },
}

const attachedArtifactsSection: ChatContextSection = {
  id: 'attached-artifacts',
  group: 'inputs',
  visibility: 'private',
  collect(message, accumulator, scope) {
    if (message.role !== 'user') {
      return
    }

    for (const part of message.parts) {
      if (!isDataArtifactAttachmentPart(part)) {
        continue
      }

      const artifact = scope.artifacts.get(part.data.artifactId)

      if (!artifact) {
        continue
      }

      accumulator.add('inputs', {
        id: `attached-artifact:${part.data.artifactId}`,
        sectionId: 'attached-artifacts',
        kind: 'artifact',
        title: toTitle(artifact.title) || 'Artifact',
        messageId: message.id,
        meta: {
          artifactId: part.data.artifactId,
          artifactKind: artifact.kind,
          version: part.data.version,
          latestVersion: artifact.latestVersion,
        },
      })
    }
  },
}

const uploadedFilesSection: ChatContextSection = {
  id: 'uploaded-files',
  group: 'inputs',
  visibility: 'public',
  collect(message, accumulator) {
    if (message.role !== 'user') {
      return
    }

    for (const part of message.parts) {
      if (
        !isRecord(part)
        || part.type !== 'file'
        || isHiddenFilePart(part as { type: string, mediaType?: string })
      ) {
        continue
      }

      const url = readString(part.url)

      if (!url) {
        continue
      }

      accumulator.add('inputs', {
        id: `file:${url}`,
        sectionId: 'uploaded-files',
        kind: 'file',
        title: toTitle(getFileName(part)),
        messageId: message.id,
        meta: {
          url,
          mediaType: readString(part.mediaType) ?? undefined,
        },
      })
    }
  },
}

const projectKnowledgeSection: ChatContextSection = {
  id: 'project-knowledge',
  group: 'inputs',
  visibility: 'private',
  collect(message, accumulator) {
    for (const part of message.parts) {
      const toolName = getContextPartToolName(part)

      if (
        !toolName
        || !isRecord(part)
        || !(PROJECT_KNOWLEDGE_TOOL_NAMES as readonly string[])
          .includes(toolName)
      ) {
        continue
      }

      const output = isRecord(part.output) ? part.output : null
      const references = Array.isArray(output?.hits)
        ? output.hits
        : [output]

      for (const reference of references) {
        if (!isRecord(reference)) {
          continue
        }

        const itemId = readString(reference.itemId)
        const title = readString(reference.title)

        if (!itemId || !title) {
          continue
        }

        accumulator.add('inputs', {
          id: `knowledge:${itemId}`,
          sectionId: 'project-knowledge',
          kind: 'knowledge',
          title: toTitle(title),
          messageId: message.id,
        })
      }
    }
  },
}

function getMemoryTitle(
  toolName: string,
  part: Record<string, unknown>,
): string {
  const output = isRecord(part.output) ? part.output : null
  const input = isRecord(part.input) ? part.input : null
  const entry = isRecord(output?.entry) ? output.entry : null
  const entryTitle = readString(entry?.title) ?? readString(input?.title)

  if (entryTitle) {
    return toTitle(entryTitle)
  }

  if (toolName === MEMORY_LIST_TOOL_NAME && Array.isArray(output?.entries)) {
    const count = output.entries.length

    return `${count} ${count === 1 ? 'entry' : 'entries'}`
  }

  return 'Memory entry'
}

const memorySection: ChatContextSection = {
  id: 'memory',
  group: 'used',
  visibility: 'private',
  collect(message, accumulator) {
    message.parts.forEach((part, index) => {
      const toolName = getContextPartToolName(part)

      if (
        !toolName
        || !isRecord(part)
        || !Object.hasOwn(MEMORY_ACTION_LABELS, toolName)
      ) {
        return
      }

      if (part.state === 'output-error') {
        return
      }

      accumulator.add('used', {
        id: `memory:${getToolCallId(part, `${message.id}:${index}`)}`,
        sectionId: 'memory',
        kind: 'memory',
        title: getMemoryTitle(toolName, part),
        messageId: message.id,
        meta: { action: MEMORY_ACTION_LABELS[toolName] },
      })
    })
  },
}

const chatSearchSection: ChatContextSection = {
  id: 'chat-search',
  group: 'used',
  visibility: 'private',
  collect(message, accumulator) {
    message.parts.forEach((part, index) => {
      const toolName = getContextPartToolName(part)

      if (
        !isRecord(part)
        || (toolName !== SEARCH_CHATS_TOOL_NAME
          && toolName !== READ_CHAT_TOOL_NAME)
      ) {
        return
      }

      const input = isRecord(part.input) ? part.input : null
      const query = readString(input?.query)
      const isSearch = toolName === SEARCH_CHATS_TOOL_NAME

      accumulator.add('used', {
        id: `chat-search:${getToolCallId(part, `${message.id}:${index}`)}`,
        sectionId: 'chat-search',
        kind: 'chat-search',
        title: isSearch && query
          ? toTitle(query)
          : 'Read a past chat',
        messageId: message.id,
        meta: { action: isSearch ? 'Searched chats' : 'Read chat' },
      })
    })
  },
}

/**
 * Web-search tools that actually ran in this answer. `messages.tools` lists
 * the tools enabled for the send, so it only fills in provider-native
 * `web_search`, which leaves no tool part behind, and only when the answer
 * cites a source. Brave and Exa count only through their own tool parts.
 */
function collectWebSearchTools(message: ChatContextMessage): Set<string> {
  const tools = new Set<string>()
  let hasSourceCitation = false

  for (const part of message.parts) {
    const toolName = getContextPartToolName(part)

    if (toolName && Object.hasOwn(WEB_SEARCH_TOOL_LABELS, toolName)) {
      tools.add(toolName)
    }

    if (isRecord(part) && part.type === 'source-url') {
      hasSourceCitation = true
    }
  }

  if (
    hasSourceCitation
    && Array.isArray(message.tools)
    && message.tools.includes(PROVIDER_WEB_SEARCH_TOOL)
  ) {
    tools.add(PROVIDER_WEB_SEARCH_TOOL)
  }

  return tools
}

const webSourcesSection: ChatContextSection = {
  id: 'web-sources',
  group: 'used',
  visibility: 'public',
  collect(message, accumulator) {
    if (message.role !== 'assistant') {
      return
    }

    for (const tool of collectWebSearchTools(message)) {
      accumulator.increment('used', {
        id: `web-search:${tool}`,
        sectionId: 'web-sources',
        kind: 'web-search',
        title: WEB_SEARCH_TOOL_LABELS[tool] ?? 'Web search',
        messageId: message.id,
        meta: { provider: tool },
      })
    }

    for (const part of message.parts) {
      if (!isRecord(part) || part.type !== 'source-url') {
        continue
      }

      const url = readString(part.url)

      if (!url || !/^https?:\/\//i.test(url)) {
        continue
      }

      const domain = getDomain(url)

      accumulator.add('used', {
        id: `source:${url}`,
        sectionId: 'web-sources',
        kind: 'web-source',
        title: toTitle(readString(part.title) ?? domain ?? url),
        messageId: message.id,
        href: url,
        meta: { domain: domain ?? undefined },
      })
    }
  },
}

const codeExecutionSection: ChatContextSection = {
  id: 'code-execution',
  group: 'used',
  visibility: 'private',
  collect(message, accumulator) {
    if (message.role !== 'assistant') {
      return
    }

    for (const part of message.parts) {
      if (getContextPartToolName(part) !== CODE_EXECUTION_TOOL_NAME) {
        continue
      }

      accumulator.increment('used', {
        id: 'code-execution',
        sectionId: 'code-execution',
        kind: 'code-execution',
        title: 'Code execution',
        messageId: message.id,
      })
    }
  },
}

export const CHAT_CONTEXT_SECTIONS: readonly ChatContextSection[] = [
  generatedImagesSection,
  researchReportsSection,
  artifactsSection,
  attachedArtifactsSection,
  uploadedFilesSection,
  projectKnowledgeSection,
  memorySection,
  chatSearchSection,
  codeExecutionSection,
  webSourcesSection,
]
