import type { ModelMessage } from 'ai'
import type { RequestEvent } from 'nuxt/server'
import type { ModelTool } from '#shared/types/providers.d'
import type { CodeExecutionProvider } from '#shared/utils/code-execution'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type { CodeExecutionInputFile } from '~~/server/utils/code-execution/input-files'
import type { ProviderResourceTracker } from '~~/server/utils/code-execution/provider-cleanup'
import { forwardAnthropicContainerIdFromLastStep } from '@ai-sdk/anthropic'
import { createError } from 'evlog'
import {
  CODE_EXECUTION_MAX_INPUT_BYTES,
  CODE_EXECUTION_MAX_INPUT_FILES,
  isCodeExecutionProvider,
} from '#shared/utils/code-execution'
import { isExternalWebSearchTool } from '#shared/utils/message-metadata'
import { resolveCodeExecutionRates } from '~~/server/utils/ai/code-execution-cost'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  extractStorageKeyFromFileUrl,
  getOwnedFilesByStorageKeys,
} from '~~/server/utils/files/file-governance'
import { resolveSendFeatures } from '~~/server/utils/features/send-features'
import { sanitizeContainerFileName } from '~~/server/utils/code-execution/file-types'
import { createProviderResourceTracker } from '~~/server/utils/code-execution/provider-cleanup'
import { uploadInputFiles } from '~~/server/utils/code-execution/input-files'

export const GEMINI_2_5_MODEL_PREFIX = 'gemini-2.5'

export const CODE_EXECUTION_INSTRUCTION = [
  'Run code is on: the AI provider runs code you write in its own sandbox,',
  'which has no internet access. Use it to analyse attached data, calculate',
  'exactly and draw charts, then explain the result in plain language.',
  'Return files the user should keep (a chart or a table, for example) as',
  'png, jpg, webp, csv, tsv, txt, md, json, pdf, docx, xlsx or pptx, at most',
  '10 files; other types are not saved. On Anthropic copy each file into',
  '$OUTPUT_DIR (top level only); on OpenAI save it under /mnt/data.',
  'Do not paste a file\'s whole content into the reply when it is saved.',
].join(' ')

/**
 * The base instruction plus, when attachments were handed to the sandbox, the
 * names of those files and how to find them. Without it a model tends to
 * retype the data it sees in the conversation instead of reading the file.
 */
export function buildCodeExecutionInstruction(
  attachedFileNames: readonly string[] = [],
): string {
  if (attachedFileNames.length === 0) {
    return CODE_EXECUTION_INSTRUCTION
  }

  const names = attachedFileNames
    .slice(0, CODE_EXECUTION_MAX_INPUT_FILES)
    .map(sanitizeContainerFileName)
    .join(', ')

  return [
    CODE_EXECUTION_INSTRUCTION,
    `The user's attached files are available inside the sandbox: ${names}.`,
    'Find them with a directory listing (OpenAI mounts them under /mnt/data,',
    'Anthropic in the container, where the name may carry a provider id)',
    'and read them in code. Do not retype or guess their content.',
  ].join(' ')
}

export interface CodeExecutionGate {
  tools: ModelTool[]
  active: boolean
  filesActive: boolean
}

export interface CodeExecutionSession {
  provider: CodeExecutionProvider
  apiKey: string
  filesActive: boolean
  tracker: ProviderResourceTracker
  uploadedFileIds: string[]
  uploadedFileNames: string[]
}

interface MessagePartLike {
  type: string
  url?: unknown
  filename?: unknown
  mediaType?: unknown
}

function isProviderRoutedDirectly(
  gatewayId: unknown,
  providerId: unknown,
): providerId is CodeExecutionProvider {
  return !gatewayId && isCodeExecutionProvider(providerId)
}

/**
 * Decides whether "Run code" is on for this send. A request that asks for it
 * on a gateway model or on a provider that has no sandbox is refused: the
 * tool exists only on the direct Anthropic, OpenAI and Google routes. A
 * request that asks for it while the feature is off for the user (flag, role
 * or the Labs opt-in) is not an error: the tool is dropped before anything
 * is registered, so nothing is spent and a retry of an older message works.
 */
export async function resolveCodeExecutionGate(input: {
  event: Pick<RequestEvent, 'context'>
  requestedTools: ModelTool[]
  gatewayId: unknown
  providerId: unknown
  modelId?: string
  logger: LoggerLike
}): Promise<CodeExecutionGate> {
  if (!input.requestedTools.includes('code_execution')) {
    return { tools: input.requestedTools, active: false, filesActive: false }
  }

  if (!isProviderRoutedDirectly(input.gatewayId, input.providerId)) {
    throw createError({
      message: 'The selected model does not support the requested tool.',
      status: 400,
      why: 'Run code is only available on direct Anthropic, OpenAI and Google models.',
      fix: 'Choose one of those models or turn off Run code.',
    })
  }

  if (
    input.providerId === 'google'
    && input.modelId?.startsWith(GEMINI_2_5_MODEL_PREFIX)
    && input.requestedTools.some(isExternalWebSearchTool)
  ) {
    throw createError({
      message: 'The selected model does not support the requested tool.',
      status: 400,
      why: 'Run code on Gemini 2.5 cannot be combined with Brave or Exa search.',
      fix: 'Turn off one of them, or choose a Gemini 3 or later model.',
    })
  }

  const features = await resolveSendFeatures(
    input.event,
    ['code-execution', 'code-execution.files'],
    input.logger,
  )
  const active = features.isFeatureActive('code-execution')
  const withoutCodeExecution = input.requestedTools.filter((tool) => {
    return tool !== 'code_execution'
  })

  input.logger.set({
    attributes: { codeExecutionGate: { active } },
  })

  return {
    tools: active ? input.requestedTools : withoutCodeExecution,
    active,
    filesActive: active && features.isFeatureActive('code-execution.files'),
  }
}

async function loadCurrentMessageFiles(
  parts: MessagePartLike[],
  userId: number,
  logger: LoggerLike,
): Promise<CodeExecutionInputFile[]> {
  const described = new Map<string, { name: string, mediaType: string }>()

  for (const part of parts) {
    if (part.type !== 'file' || typeof part.url !== 'string') {
      continue
    }

    const key = extractStorageKeyFromFileUrl(part.url)

    if (key) {
      described.set(key, {
        name: typeof part.filename === 'string' ? part.filename : 'file',
        mediaType: typeof part.mediaType === 'string'
          ? part.mediaType
          : 'application/octet-stream',
      })
    }
  }

  const storageKeys = [...described.keys()]

  if (storageKeys.length === 0) {
    return []
  }

  const owned = await getOwnedFilesByStorageKeys(userId, storageKeys)
  const storage = useFileStorage()
  const files: CodeExecutionInputFile[] = []

  let selectedCount = 0
  let selectedBytes = 0

  for (const storageKey of storageKeys) {
    const record = described.get(storageKey)
    const ownedFile = owned.get(storageKey)

    if (!record || !ownedFile) {
      continue
    }

    if (
      selectedCount >= CODE_EXECUTION_MAX_INPUT_FILES
      || selectedBytes + ownedFile.size > CODE_EXECUTION_MAX_INPUT_BYTES
    ) {
      continue
    }

    selectedCount += 1
    selectedBytes += ownedFile.size

    try {
      const object = await storage.get(storageKey)

      if (!object) {
        continue
      }

      files.push({
        name: record.name,
        mediaType: record.mediaType,
        bytes: new Uint8Array(await object.arrayBuffer()),
      })
    } catch (exception) {
      logger.set({
        attributes: {
          codeExecutionInputs: { error: exceptionMessage(exception) },
        },
      })
    }
  }

  return files
}

/**
 * Opens the provider side of one "Run code" send: decrypts the user's key
 * (never logged), creates the tracker that deletes everything Besidka puts at
 * the provider, and, with `code-execution.files`, uploads the attachments of
 * the current message for Anthropic and OpenAI. Gemini takes attachments
 * inline.
 */
export async function startCodeExecutionSession(input: {
  userId: number
  provider: CodeExecutionProvider
  filesActive: boolean
  newMessageParts: MessagePartLike[]
  logger: LoggerLike
  fetcher?: typeof fetch
}): Promise<CodeExecutionSession> {
  const key = await useDb().query.keys.findFirst({
    where: { userId: input.userId, provider: input.provider },
    columns: { apiKey: true },
  })

  if (!key?.apiKey) {
    throw createError({
      message: 'An API key is required for this provider.',
      status: 401,
    })
  }

  const apiKey = await useDecryptText(key.apiKey)
  const tracker = createProviderResourceTracker({
    provider: input.provider,
    apiKey,
    logger: input.logger,
    fetcher: input.fetcher,
  })
  const session: CodeExecutionSession = {
    provider: input.provider,
    apiKey,
    filesActive: input.filesActive,
    tracker,
    uploadedFileIds: [],
    uploadedFileNames: [],
  }

  if (!input.filesActive || input.provider === 'google') {
    return session
  }

  try {
    const files = await loadCurrentMessageFiles(
      input.newMessageParts,
      input.userId,
      input.logger,
    )
    const uploaded = await uploadInputFiles({
      provider: input.provider,
      apiKey,
      files,
      tracker,
      logger: input.logger,
      fetcher: input.fetcher,
    })

    session.uploadedFileIds = uploaded.map(file => file.fileId)
    session.uploadedFileNames = uploaded.map(file => file.name)
  } catch (exception) {
    await tracker.cleanup()
    throw exception
  }

  return session
}

export function resolveCodeExecutionRatesFromConfig() {
  return resolveCodeExecutionRates(useRuntimeConfig().public)
}

/**
 * Adds the uploaded files to the last user message as Anthropic
 * `container_upload` blocks, which hand them to the code execution
 * container instead of the model's context.
 */
export function appendAnthropicContainerUploads(
  messages: ModelMessage[],
  fileIds: string[],
): ModelMessage[] {
  if (fileIds.length === 0) {
    return messages
  }

  const lastUserIndex = messages.findLastIndex((message) => {
    return message.role === 'user'
  })

  if (lastUserIndex === -1) {
    return messages
  }

  const lastUser = messages[lastUserIndex]

  if (!lastUser || lastUser.role !== 'user') {
    return messages
  }

  const content = typeof lastUser.content === 'string'
    ? [{ type: 'text' as const, text: lastUser.content }]
    : lastUser.content
  const uploads = fileIds.map((fileId) => {
    return {
      type: 'file' as const,
      data: { anthropic: fileId },
      mediaType: 'application/octet-stream',
      providerOptions: { anthropic: { containerUpload: true } },
    }
  })

  return messages.map((message, index) => {
    return index === lastUserIndex
      ? { ...lastUser, content: [...content, ...uploads] }
      : message
  })
}

type PrepareStep = (options: { steps: unknown[] }) => unknown

/**
 * Keeps the Anthropic container across the steps of a tool loop, so files
 * and state from an earlier step are still there. Only wraps a loop that
 * already exists; without app tools there is a single step.
 */
export function withAnthropicContainerForwarding<
  TOptions extends { prepareStep: unknown },
>(options: TOptions): TOptions {
  const original = options.prepareStep as PrepareStep

  const prepareStep = async (stepOptions: { steps: unknown[] }) => {
    const base = await original(stepOptions) as
      | { providerOptions?: Record<string, Record<string, unknown>> }
      | undefined
    const forwarded = forwardAnthropicContainerIdFromLastStep({
      steps: stepOptions.steps as Parameters<
        typeof forwardAnthropicContainerIdFromLastStep
      >[0]['steps'],
    })

    if (!forwarded?.providerOptions) {
      return base
    }

    return {
      ...base,
      providerOptions: {
        ...base?.providerOptions,
        ...forwarded.providerOptions,
        anthropic: {
          ...base?.providerOptions?.anthropic,
          ...forwarded.providerOptions.anthropic,
        },
      },
    }
  }

  return { ...options, prepareStep }
}
