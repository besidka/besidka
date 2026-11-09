import {
  ARTIFACT_KINDS,
  CLIPBOARD_FAILURE_REASONS,
  CLIPBOARD_MIME_TYPES,
  DIAGRAM_EXPORT_ACTIONS,
  DISPLAY_MODES,
  LOG_LEVELS,
  MAX_COMPLETE_OUTPUT_TOKENS,
  MAX_CLIPBOARD_TEXT_LENGTH,
  MAX_COMPLETE_PROMPT_LENGTH,
  MAX_COMPLETE_SYSTEM_LENGTH,
  MAX_DIAGRAM_SOURCE_LENGTH,
  MAX_FRAME_HEIGHT,
  MAX_JSON_DEPTH,
  MAX_JSON_NODES,
  MAX_LINK_URL_LENGTH,
  MAX_LOG_MESSAGE_LENGTH,
  MAX_STORAGE_KEY_LENGTH,
  MAX_STORAGE_VALUE_BYTES,
  REQUESTABLE_DISPLAY_MODES,
  STORAGE_MODES,
  THEMES,
} from './constants.ts'
import { isRecord } from './jsonrpc.ts'
import { isDiagramLimitCode } from './mermaid-limits.ts'
import type {
  ArtifactKind,
  ArtifactPayload,
  ClipboardWriteParams,
  ClipboardWriteResult,
  CompleteParams,
  DiagramExportParams,
  DiagramExportResult,
  DisplayMode,
  HostContext,
  HostContextChangedParams,
  InitializeParams,
  InitializeResult,
  JsonValue,
  LogMessageParams,
  OpenDiagramViewerParams,
  OpenLinkParams,
  RequestDisplayModeParams,
  RequestDisplayModeResult,
  SizeChangedParams,
  StorageGetResult,
  StorageKeyParams,
  StorageListParams,
  StorageListResult,
  StorageSetParams,
  CompleteResult,
  Theme,
  ToolInputPartialParams,
  ToolResultParams,
} from './messages.ts'

export interface JsonLimits {
  maxNodes: number
  maxDepth: number
  maxBytes: number
}

export const STORAGE_JSON_LIMITS: JsonLimits = {
  maxNodes: MAX_JSON_NODES,
  maxDepth: MAX_JSON_DEPTH,
  maxBytes: MAX_STORAGE_VALUE_BYTES,
}

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const DIRECTION_CONTROL_CODES = new Set([
  0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E,
  0x2066, 0x2067, 0x2068, 0x2069,
])

function isControlCode(code: number): boolean {
  return code < 0x20 || code === 0x7F
}

function hasCharacter(value: string, matches: (code: number) => boolean) {
  for (let index = 0; index < value.length; index += 1) {
    if (matches(value.charCodeAt(index))) {
      return true
    }
  }

  return false
}

function hasUnsafeLinkCharacter(value: string): boolean {
  return hasCharacter(value, (code) => {
    return isControlCode(code) || DIRECTION_CONTROL_CODES.has(code)
  })
}

function isOneOf<Value extends string>(
  values: readonly Value[],
  value: unknown,
): value is Value {
  return typeof value === 'string' && values.includes(value as Value)
}

export function isArtifactKind(value: unknown): value is ArtifactKind {
  return isOneOf(ARTIFACT_KINDS, value)
}

export function isTheme(value: unknown): value is Theme {
  return isOneOf(THEMES, value)
}

export function isDisplayMode(value: unknown): value is DisplayMode {
  return isOneOf(DISPLAY_MODES, value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.getPrototypeOf(value) === Object.prototype
}

function measureScalar(value: unknown): number | null {
  if (value === null || typeof value === 'boolean') {
    return 5
  }

  if (typeof value === 'string') {
    return value.length + 2
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? 24 : null
  }

  return null
}

/**
 * Walks a structured-clone result iteratively and returns its approximate
 * JSON size, or null when it is not plain JSON or exceeds the limits.
 * Every object may be visited once, so shared references (which structured
 * clone preserves) and cycles cannot make the walk exponential.
 */
export function measureJsonValue(
  value: unknown,
  limits: JsonLimits = STORAGE_JSON_LIMITS,
): number | null {
  const visited = new Set<object>()
  const stack: Array<[unknown, number]> = [[value, 0]]
  let nodeCount = 0
  let byteCount = 0

  while (stack.length > 0) {
    const [current, depth] = stack.pop() as [unknown, number]

    nodeCount += 1

    if (nodeCount > limits.maxNodes || depth > limits.maxDepth) {
      return null
    }

    if (typeof current !== 'object' || current === null) {
      const size = measureScalar(current)

      if (size === null) {
        return null
      }

      byteCount += size
    } else {
      if (visited.has(current)) {
        return null
      }

      visited.add(current)

      if (Array.isArray(current)) {
        if (current.length > limits.maxNodes) {
          return null
        }

        byteCount += current.length + 2

        for (let index = 0; index < current.length; index += 1) {
          stack.push([current[index], depth + 1])
        }
      } else if (isPlainObject(current)) {
        const keys = Object.keys(current)

        if (keys.length > limits.maxNodes) {
          return null
        }

        for (const key of keys) {
          if (RESERVED_KEYS.has(key)) {
            return null
          }

          byteCount += key.length + 4
          stack.push([current[key], depth + 1])
        }

        byteCount += 2
      } else {
        return null
      }
    }

    if (byteCount > limits.maxBytes) {
      return null
    }
  }

  return byteCount
}

export function isJsonValue(
  value: unknown,
  limits: JsonLimits = STORAGE_JSON_LIMITS,
): value is JsonValue {
  return measureJsonValue(value, limits) !== null
}

export function isHostContext(value: unknown): value is HostContext {
  return isRecord(value)
    && isTheme(value.theme)
    && isDisplayMode(value.displayMode)
    && typeof value.locale === 'string'
    && isRecord(value.capabilities)
    && isOneOf(STORAGE_MODES, value.capabilities.storage)
    && typeof value.capabilities.complete === 'boolean'
}

export function isInitializeParams(value: unknown): value is InitializeParams {
  return isRecord(value)
    && typeof value.protocolVersion === 'number'
    && isRecord(value.appCapabilities)
    && Array.isArray(value.appCapabilities.kinds)
    && value.appCapabilities.kinds.every(isArtifactKind)
}

export function isInitializeResult(value: unknown): value is InitializeResult {
  return isRecord(value)
    && typeof value.protocolVersion === 'number'
    && isHostContext(value.hostContext)
}

export function isArtifactPayload(value: unknown): value is ArtifactPayload {
  return isRecord(value)
    && isArtifactKind(value.kind)
    && typeof value.title === 'string'
    && typeof value.content === 'string'
}

export function isToolInputPartialParams(
  value: unknown,
): value is ToolInputPartialParams {
  return isRecord(value) && isArtifactPayload(value.arguments)
}

export function isToolResultParams(value: unknown): value is ToolResultParams {
  if (!isRecord(value) || !isArtifactPayload(value.structuredContent)) {
    return false
  }

  const content: Record<string, unknown> = { ...value.structuredContent }

  return (content.artifactId === undefined
    || typeof content.artifactId === 'string')
  && (content.version === undefined
    || (typeof content.version === 'number'
      && Number.isInteger(content.version)))
}

export function isHostContextChangedParams(
  value: unknown,
): value is HostContextChangedParams {
  return isRecord(value)
    && (value.theme === undefined || isTheme(value.theme))
    && (value.displayMode === undefined || isDisplayMode(value.displayMode))
}

export function isSizeChangedParams(
  value: unknown,
): value is SizeChangedParams {
  return isRecord(value)
    && typeof value.height === 'number'
    && Number.isFinite(value.height)
    && value.height >= 0
    && value.height <= MAX_FRAME_HEIGHT
}

export function normalizeLinkUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_LINK_URL_LENGTH) {
    return null
  }

  if (hasUnsafeLinkCharacter(value)) {
    return null
  }

  try {
    const url = new URL(value)
    const isWebUrl = url.protocol === 'https:' || url.protocol === 'http:'

    if (!isWebUrl || url.username || url.password) {
      return null
    }

    return url.href
  } catch {
    return null
  }
}

export function isOpenLinkParams(value: unknown): value is OpenLinkParams {
  return isRecord(value) && normalizeLinkUrl(value.url) !== null
}

export function isLogMessageParams(value: unknown): value is LogMessageParams {
  return isRecord(value)
    && isOneOf(LOG_LEVELS, value.level)
    && isRecord(value.data)
    && typeof value.data.message === 'string'
    && value.data.message.length <= MAX_LOG_MESSAGE_LENGTH
    && (value.data.stack === undefined
      || (typeof value.data.stack === 'string'
        && value.data.stack.length <= MAX_LOG_MESSAGE_LENGTH))
      && (value.data.code === undefined || isDiagramLimitCode(value.data.code))
      && isOptionalPositiveInteger(value.data.limit)
      && isOptionalPositiveInteger(value.data.found)
}

function isOptionalPositiveInteger(value: unknown): boolean {
  return value === undefined
    || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
}

export function isStorageKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_STORAGE_KEY_LENGTH
    && !hasCharacter(value, isControlCode)
    && !RESERVED_KEYS.has(value)
}

export function isStorageKeyParams(
  value: unknown,
): value is StorageKeyParams {
  return isRecord(value) && isStorageKey(value.key)
}

export function isStorageSetParams(
  value: unknown,
): value is StorageSetParams {
  return isRecord(value)
    && isStorageKey(value.key)
    && 'value' in value
    && isJsonValue(value.value)
}

export function isStorageListParams(
  value: unknown,
): value is StorageListParams {
  return isRecord(value)
    && (value.prefix === undefined
      || (typeof value.prefix === 'string'
        && value.prefix.length <= MAX_STORAGE_KEY_LENGTH))
}

export function isStorageGetResult(value: unknown): value is StorageGetResult {
  return isRecord(value) && 'value' in value && isJsonValue(value.value)
}

export function isStorageListResult(
  value: unknown,
): value is StorageListResult {
  return isRecord(value)
    && Array.isArray(value.keys)
    && value.keys.length <= MAX_JSON_NODES
    && value.keys.every((key) => {
      return typeof key === 'string'
    })
}

export function isCompleteParams(value: unknown): value is CompleteParams {
  return isRecord(value)
    && typeof value.prompt === 'string'
    && value.prompt.length > 0
    && value.prompt.length <= MAX_COMPLETE_PROMPT_LENGTH
    && (value.system === undefined
      || (typeof value.system === 'string'
        && value.system.length <= MAX_COMPLETE_SYSTEM_LENGTH))
      && (value.maxOutputTokens === undefined
        || (typeof value.maxOutputTokens === 'number'
          && Number.isInteger(value.maxOutputTokens)
          && value.maxOutputTokens > 0
          && value.maxOutputTokens <= MAX_COMPLETE_OUTPUT_TOKENS))
}

export function isCompleteResult(value: unknown): value is CompleteResult {
  return isRecord(value) && typeof value.text === 'string'
}

export function isEmptyParams(value: unknown): boolean {
  return value === undefined || isRecord(value)
}

export function isClipboardWriteParams(
  value: unknown,
): value is ClipboardWriteParams {
  return isRecord(value)
    && typeof value.text === 'string'
    && value.text.length <= MAX_CLIPBOARD_TEXT_LENGTH
    && typeof value.userActivation === 'boolean'
    && (value.mimeType === undefined
      || isOneOf(CLIPBOARD_MIME_TYPES, value.mimeType))
}

export function isClipboardWriteResult(
  value: unknown,
): value is ClipboardWriteResult {
  if (!isRecord(value)) {
    return false
  }

  if (value.copied === true) {
    return true
  }

  return value.copied === false
    && isOneOf(CLIPBOARD_FAILURE_REASONS, value.reason)
}

export function isRequestDisplayModeParams(
  value: unknown,
): value is RequestDisplayModeParams {
  return isRecord(value)
    && isOneOf(REQUESTABLE_DISPLAY_MODES, value.mode)
    && typeof value.userActivation === 'boolean'
}

export function isRequestDisplayModeResult(
  value: unknown,
): value is RequestDisplayModeResult {
  return isRecord(value) && isDisplayMode(value.displayMode)
}

export function isDiagramExportParams(
  value: unknown,
): value is DiagramExportParams {
  return isRecord(value)
    && typeof value.source === 'string'
    && value.source.trim().length > 0
    && value.source.length <= MAX_DIAGRAM_SOURCE_LENGTH
    && typeof value.action === 'string'
    && (DIAGRAM_EXPORT_ACTIONS as readonly string[]).includes(value.action)
    && typeof value.userActivation === 'boolean'
}

export function isDiagramExportResult(
  value: unknown,
): value is DiagramExportResult {
  return isRecord(value) && typeof value.completed === 'boolean'
}

export function isOpenDiagramViewerParams(
  value: unknown,
): value is OpenDiagramViewerParams {
  return isRecord(value)
    && typeof value.source === 'string'
    && value.source.trim().length > 0
    && value.source.length <= MAX_DIAGRAM_SOURCE_LENGTH
    && typeof value.userActivation === 'boolean'
}
