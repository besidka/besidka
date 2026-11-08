import {
  ARTIFACT_KINDS,
  DISPLAY_MODES,
  LOG_LEVELS,
  MAX_COMPLETE_PROMPT_LENGTH,
  MAX_LINK_URL_LENGTH,
  MAX_LOG_MESSAGE_LENGTH,
  MAX_STORAGE_KEY_LENGTH,
  STORAGE_MODES,
  THEMES,
} from './constants.ts'
import { isRecord } from './jsonrpc.ts'
import type {
  ArtifactKind,
  ArtifactPayload,
  CompleteParams,
  DisplayMode,
  HostContext,
  HostContextChangedParams,
  InitializeParams,
  InitializeResult,
  JsonValue,
  LogMessageParams,
  OpenLinkParams,
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

const MAX_JSON_DEPTH = 32

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

export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > MAX_JSON_DEPTH) {
    return false
  }

  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return true
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (Array.isArray(value)) {
    return value.every((item) => {
      return isJsonValue(item, depth + 1)
    })
  }

  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return false
  }

  return Object.values(value).every((item) => {
    return isJsonValue(item, depth + 1)
  })
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
}

export function isOpenLinkParams(value: unknown): value is OpenLinkParams {
  if (!isRecord(value) || typeof value.url !== 'string') {
    return false
  }

  if (value.url.length > MAX_LINK_URL_LENGTH) {
    return false
  }

  try {
    const url = new URL(value.url)

    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
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
}

function isStorageKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_STORAGE_KEY_LENGTH
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
    && value.keys.every((key) => {
      return typeof key === 'string'
    })
}

export function isCompleteParams(value: unknown): value is CompleteParams {
  return isRecord(value)
    && typeof value.prompt === 'string'
    && value.prompt.length > 0
    && value.prompt.length <= MAX_COMPLETE_PROMPT_LENGTH
    && (value.maxOutputTokens === undefined
      || (typeof value.maxOutputTokens === 'number'
        && Number.isInteger(value.maxOutputTokens)
        && value.maxOutputTokens > 0))
}

export function isCompleteResult(value: unknown): value is CompleteResult {
  return isRecord(value) && typeof value.text === 'string'
}

export function isEmptyParams(value: unknown): boolean {
  return value === undefined || isRecord(value)
}
