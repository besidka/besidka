import {
  DOCUMENT_FORMAT_LABELS,
  DOCUMENT_FORMATS,
  DOCUMENT_TOOL_NAME,
} from '#shared/utils/documents'
import type { DocumentFormat } from '#shared/utils/documents'
import { CONNECTOR_TOOL_NAME_PREFIX } from '#shared/utils/connectors-policy'
import { BESIDKA_TOOL_NAME_PREFIX } from '#shared/utils/besidka-tool-permissions'
import { SKILL_ACTIVATE_TOOL_NAME } from '#shared/utils/skills/runtime'
import { TOOL_INDEX_LOAD_TOOL_NAME } from '#shared/utils/tool-index'
import type { SearchProvider } from '#shared/types/message-usage.d'
import { CHAT_MEMORY_ICON } from '~/utils/chat-memory-exclusion'
import { CODE_EXECUTION_TOOL_ICON } from '~/utils/code-execution-ui'
import { DOCUMENT_FORMAT_ICONS } from '~/utils/document-ui'

export const REASONING_STEP_ICON_COLLECTIONS = [
  'lucide',
  'simple-icons',
  'bxl',
  'streamline-logos',
] as const

export const REASONING_STEP_GENERIC_ICON = 'lucide:wrench'
export const REASONING_STEP_CONNECTOR_ICON = 'lucide:plug'
export const REASONING_STEP_WEB_ICON = 'lucide:globe'
export const REASONING_STEP_SKILL_ICON = 'lucide:sparkles'
export const REASONING_STEP_CHAT_ICON = 'lucide:messages-square'
export const REASONING_STEP_KNOWLEDGE_ICON = 'lucide:folder-search'
export const REASONING_STEP_ARTIFACT_ICON = 'lucide:app-window'
export const REASONING_STEP_IMAGE_ICON = 'lucide:image'
export const REASONING_STEP_DOCUMENT_ICON = 'lucide:file-text'

export type ReasoningStepIcon
  = | { kind: 'iconify', name: string }
    | { kind: 'provider', providerId: string }
    | { kind: 'besidka' }
    | { kind: 'connector', connectorId: string, letter: string }

export interface ReasoningStepSourceInput {
  toolName: string
  title: string
  isPending?: boolean
  isFailed?: boolean
  isAwaitingApproval?: boolean
  searchProvider?: string | null
  documentFormat?: string | null
  connectorId?: string | null
  connectorTitle?: string | null
  allowConnectorIcon?: boolean
}

export interface ReasoningStepSource {
  icon: ReasoningStepIcon
  label: string
}

const NATIVE_SEARCH_TOOL_NAMES = new Set<string>([
  'web_search',
  'web_search_preview',
])
const SEARCH_PROVIDERS = new Set<SearchProvider>([
  'google',
  'anthropic',
  'openai',
  'xai',
  'deepseek',
  'brave',
  'exa',
])
const MEMORY_TOOL_NAMES = new Set<string>([
  'memory_list',
  'memory_read',
  'memory_write',
  'memory_forget',
])
const CHAT_TOOL_NAMES = new Set<string>(['search_chats', 'read_chat'])
const KNOWLEDGE_TOOL_NAMES = new Set<string>([
  'search_project_knowledge',
  'read_project_knowledge',
])
const SKILL_TOOL_NAMES = new Set<string>([
  SKILL_ACTIVATE_TOOL_NAME,
  'read_skill_file',
])
const ARTIFACT_TOOL_NAMES = new Set<string>([
  'create_artifact',
  'update_artifact',
])
const FALLBACK_LETTER = '?'

function isSearchProvider(value: unknown): value is SearchProvider {
  return typeof value === 'string'
    && SEARCH_PROVIDERS.has(value as SearchProvider)
}

function isDocumentFormat(value: unknown): value is DocumentFormat {
  return typeof value === 'string'
    && (DOCUMENT_FORMATS as readonly string[]).includes(value)
}

/**
 * The document format a `create_document` call asked for, read from the
 * part's input. The input has no `format` while it still streams in, so the
 * result is null and the step keeps its generic document title and icon.
 */
export function getToolPartDocumentFormat(part: unknown): string | null {
  if (typeof part !== 'object' || part === null) {
    return null
  }

  const input = (part as { input?: unknown }).input

  if (typeof input !== 'object' || input === null) {
    return null
  }

  const format = (input as { format?: unknown }).format

  return isDocumentFormat(format) ? format : null
}

export function getConnectorLetter(title: string | null | undefined): string {
  const first = (title ?? '').trim().charAt(0)

  return first ? first.toUpperCase() : FALLBACK_LETTER
}

function getSearchIcon(
  toolName: string,
  searchProvider: string | null | undefined,
): ReasoningStepIcon {
  if (toolName === 'web_search_brave') {
    return { kind: 'provider', providerId: 'brave' }
  }

  if (toolName === 'web_search_exa') {
    return { kind: 'provider', providerId: 'exa' }
  }

  if (isSearchProvider(searchProvider)) {
    return { kind: 'provider', providerId: searchProvider }
  }

  return { kind: 'iconify', name: REASONING_STEP_WEB_ICON }
}

function getConnectorIcon(input: ReasoningStepSourceInput): ReasoningStepIcon {
  if (input.allowConnectorIcon && input.connectorId) {
    return {
      kind: 'connector',
      connectorId: input.connectorId,
      letter: getConnectorLetter(input.connectorTitle),
    }
  }

  return { kind: 'iconify', name: REASONING_STEP_CONNECTOR_ICON }
}

export function getDocumentStepLabel(
  format: DocumentFormat,
  isPending: boolean,
  isFailed: boolean,
  failedTitle: string,
): string {
  if (isFailed) {
    return failedTitle
  }

  const formatLabel = DOCUMENT_FORMAT_LABELS[format]

  return isPending ? `Creating ${formatLabel}` : `Created ${formatLabel}`
}

/**
 * The icon and the label of one reasoning step. The label is the title the
 * step already has, except for a document step whose format is known
 * ("Creating DOCX"). The icon names the source: the search vendor that ran
 * the search, the file type of a document, a connector's own icon, or the
 * Besidka mark for Besidka's own tools. Icons are decoration; the label
 * carries the meaning.
 */
export function resolveReasoningStepSource(
  input: ReasoningStepSourceInput,
): ReasoningStepSource {
  const { toolName } = input

  if (toolName.startsWith(CONNECTOR_TOOL_NAME_PREFIX)) {
    return { icon: getConnectorIcon(input), label: input.title }
  }

  if (toolName.startsWith(BESIDKA_TOOL_NAME_PREFIX)) {
    return { icon: { kind: 'besidka' }, label: input.title }
  }

  if (
    toolName === 'web_search_brave'
    || toolName === 'web_search_exa'
    || NATIVE_SEARCH_TOOL_NAMES.has(toolName)
  ) {
    return {
      icon: getSearchIcon(toolName, input.searchProvider),
      label: input.title,
    }
  }

  if (toolName === DOCUMENT_TOOL_NAME) {
    if (!isDocumentFormat(input.documentFormat)) {
      return {
        icon: { kind: 'iconify', name: REASONING_STEP_DOCUMENT_ICON },
        label: input.title,
      }
    }

    return {
      icon: {
        kind: 'iconify',
        name: DOCUMENT_FORMAT_ICONS[input.documentFormat],
      },
      label: input.isAwaitingApproval
        ? input.title
        : getDocumentStepLabel(
          input.documentFormat,
          input.isPending ?? false,
          input.isFailed ?? false,
          input.title,
        ),
    }
  }

  return { icon: getStaticIcon(toolName), label: input.title }
}

function getStaticIcon(toolName: string): ReasoningStepIcon {
  if (MEMORY_TOOL_NAMES.has(toolName)) {
    return { kind: 'iconify', name: CHAT_MEMORY_ICON }
  }

  if (SKILL_TOOL_NAMES.has(toolName)) {
    return { kind: 'iconify', name: REASONING_STEP_SKILL_ICON }
  }

  if (CHAT_TOOL_NAMES.has(toolName)) {
    return { kind: 'iconify', name: REASONING_STEP_CHAT_ICON }
  }

  if (KNOWLEDGE_TOOL_NAMES.has(toolName)) {
    return { kind: 'iconify', name: REASONING_STEP_KNOWLEDGE_ICON }
  }

  if (ARTIFACT_TOOL_NAMES.has(toolName)) {
    return { kind: 'iconify', name: REASONING_STEP_ARTIFACT_ICON }
  }

  if (toolName === 'code_execution') {
    return { kind: 'iconify', name: CODE_EXECUTION_TOOL_ICON }
  }

  if (toolName === 'generate_image') {
    return { kind: 'iconify', name: REASONING_STEP_IMAGE_ICON }
  }

  if (toolName === TOOL_INDEX_LOAD_TOOL_NAME) {
    return { kind: 'iconify', name: REASONING_STEP_CONNECTOR_ICON }
  }

  return { kind: 'iconify', name: REASONING_STEP_GENERIC_ICON }
}
