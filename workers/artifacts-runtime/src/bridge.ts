import {
  ERROR_CODES,
  INTERACTIVE_REQUEST_TIMEOUT_MS,
  MAX_COMPLETE_OUTPUT_TOKENS,
  MAX_COMPLETE_PROMPT_LENGTH,
  MAX_STORAGE_KEY_LENGTH,
  METHODS,
  RpcError,
  isJsonValue,
  isMethodNotFound,
  isStorageKey,
} from '@besidka/artifacts-protocol'
import type {
  HostCapabilities,
  JsonValue,
  RuntimeConnection,
  Theme,
} from '@besidka/artifacts-protocol'
import { getTheme, onThemeChange } from './theme.ts'

export interface BesidkaStorage {
  readonly persistent: boolean
  get: (key: string) => Promise<JsonValue | null>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  list: (prefix?: string) => Promise<string[]>
}

export interface CompleteOptions {
  maxOutputTokens?: number
}

export interface BesidkaApi {
  readonly storage: BesidkaStorage
  readonly theme: Theme
  complete: (prompt: string, options?: CompleteOptions) => Promise<string>
  onThemeChange: (listener: (theme: Theme) => void) => () => void
}

export class BesidkaBridgeError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'BesidkaBridgeError'
    this.code = code
  }
}

const COMPLETE_ERROR_MESSAGES: Record<number, string> = {
  [ERROR_CODES.methodNotFound]: 'AI completions are not available here.',
  [ERROR_CODES.consentRequired]:
    'The viewer has not allowed AI completions for this artifact.',
  [ERROR_CODES.declinedByViewer]: 'The viewer declined this AI completion.',
  [ERROR_CODES.rateLimited]: 'Too many AI completions. Try again later.',
  [ERROR_CODES.notAllowed]: 'AI completions are not allowed for this artifact.',
  [ERROR_CODES.requestTimeout]: 'The AI completion timed out.',
}

const STORAGE_ERROR_MESSAGES: Record<number, string> = {
  [ERROR_CODES.consentRequired]:
    'The viewer has not allowed this artifact to save data.',
  [ERROR_CODES.rateLimited]: 'Too many storage requests. Try again later.',
  [ERROR_CODES.notAllowed]: 'Saving data is not allowed for this artifact.',
  [ERROR_CODES.invalidParams]:
    'The storage key or value was rejected (too large or invalid).',
  [ERROR_CODES.requestTimeout]: 'The storage request timed out.',
}

function toBridgeError(
  exception: unknown,
  messages: Record<number, string>,
  fallbackMessage: string,
) {
  if (exception instanceof RpcError) {
    return new BesidkaBridgeError(
      exception.code,
      messages[exception.code] ?? exception.message,
    )
  }

  return new BesidkaBridgeError(ERROR_CODES.internalError, fallbackMessage)
}

function assertStorageKey(key: unknown): asserts key is string {
  if (!isStorageKey(key)) {
    throw new TypeError(
      `Storage keys must be non-empty strings of at most ${MAX_STORAGE_KEY_LENGTH} characters, without control characters or reserved names.`,
    )
  }
}

function toJsonValue(value: unknown): JsonValue {
  let normalized: unknown

  try {
    const serialized = JSON.stringify(value)

    normalized = serialized === undefined ? undefined : JSON.parse(serialized)
  } catch {
    normalized = undefined
  }

  if (normalized === undefined || !isJsonValue(normalized)) {
    throw new TypeError(
      'Storage values must be JSON-serialisable and at most 100 KB.',
    )
  }

  return normalized
}

function cloneJsonValue(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Builds the frozen `window.besidka` object. Storage goes to the host when it
 * offers persistent storage and falls back to memory when the host does not
 * implement it (`-32601`). Every AI completion is a host request the host
 * may hold open while it asks the viewer for consent, so it gets the longer
 * interactive timeout; consent and rate-limit refusals surface as
 * `BesidkaBridgeError` with the JSON-RPC code.
 */
export function createBesidkaApi(
  connection: RuntimeConnection,
  capabilities: HostCapabilities,
): BesidkaApi {
  const memoryStore = new Map<string, JsonValue>()
  let persistent = capabilities.storage === 'persistent'

  async function withStorage<Result>(
    remote: () => Promise<Result>,
    local: () => Result,
  ): Promise<Result> {
    if (!persistent) {
      return local()
    }

    try {
      return await remote()
    } catch (exception) {
      if (isMethodNotFound(exception)) {
        persistent = false

        return local()
      }

      throw toBridgeError(
        exception,
        STORAGE_ERROR_MESSAGES,
        'Storage request failed.',
      )
    }
  }

  const storage: BesidkaStorage = Object.freeze({
    get persistent() {
      return persistent
    },
    async get(key: string) {
      assertStorageKey(key)

      return withStorage(async () => {
        const result = await connection.request(METHODS.storageGet, { key })

        return result.value
      }, () => {
        const value = memoryStore.get(key)

        return value === undefined ? null : cloneJsonValue(value)
      })
    },
    async set(key: string, value: unknown) {
      assertStorageKey(key)

      const jsonValue = toJsonValue(value)

      await withStorage(async () => {
        await connection.request(METHODS.storageSet, {
          key,
          value: jsonValue,
        })
      }, () => {
        memoryStore.set(key, jsonValue)
      })
    },
    async delete(key: string) {
      assertStorageKey(key)

      await withStorage(async () => {
        await connection.request(METHODS.storageDelete, { key })
      }, () => {
        memoryStore.delete(key)
      })
    },
    async list(prefix?: string) {
      if (prefix !== undefined && typeof prefix !== 'string') {
        throw new TypeError('The list prefix must be a string.')
      }

      return withStorage(async () => {
        const result = await connection.request(
          METHODS.storageList,
          prefix === undefined ? {} : { prefix },
        )

        return result.keys
      }, () => {
        return [...memoryStore.keys()].filter((key) => {
          return prefix === undefined || key.startsWith(prefix)
        }).sort()
      })
    },
  })

  async function complete(prompt: string, options: CompleteOptions = {}) {
    if (!capabilities.complete) {
      throw new BesidkaBridgeError(
        ERROR_CODES.methodNotFound,
        COMPLETE_ERROR_MESSAGES[ERROR_CODES.methodNotFound] ?? '',
      )
    }

    if (
      typeof prompt !== 'string'
      || prompt.length === 0
      || prompt.length > MAX_COMPLETE_PROMPT_LENGTH
    ) {
      throw new TypeError(
        `The prompt must be a non-empty string of at most ${MAX_COMPLETE_PROMPT_LENGTH} characters.`,
      )
    }

    const maxOutputTokens = options.maxOutputTokens

    if (
      maxOutputTokens !== undefined
      && (
        !Number.isInteger(maxOutputTokens)
        || maxOutputTokens <= 0
        || maxOutputTokens > MAX_COMPLETE_OUTPUT_TOKENS
      )
    ) {
      throw new TypeError(
        `maxOutputTokens must be an integer from 1 to ${MAX_COMPLETE_OUTPUT_TOKENS}.`,
      )
    }

    try {
      const result = await connection.request(
        METHODS.complete,
        maxOutputTokens === undefined
          ? { prompt }
          : { prompt, maxOutputTokens },
        { timeoutMs: INTERACTIVE_REQUEST_TIMEOUT_MS },
      )

      return result.text
    } catch (exception) {
      throw toBridgeError(
        exception,
        COMPLETE_ERROR_MESSAGES,
        'The AI completion failed.',
      )
    }
  }

  return Object.freeze({
    storage,
    get theme() {
      return getTheme()
    },
    complete,
    onThemeChange(listener: (theme: Theme) => void) {
      if (typeof listener !== 'function') {
        throw new TypeError('onThemeChange expects a function.')
      }

      return onThemeChange(listener)
    },
  })
}

export function installBesidkaApi(api: BesidkaApi) {
  Object.defineProperty(window, 'besidka', {
    value: api,
    enumerable: true,
    configurable: false,
    writable: false,
  })
}
