import {
  CONNECT_MESSAGE_TYPE,
  ERROR_CODES,
  PROTOCOL_VERSION,
} from './constants.ts'

export type JsonRpcId = number | string

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface JsonRpcErrorObject {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  error: JsonRpcErrorObject
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse

export type JsonRpcMessage
  = | JsonRpcRequest
    | JsonRpcNotification
    | JsonRpcResponse

export interface ConnectMessage {
  type: typeof CONNECT_MESSAGE_TYPE
  protocol: number
}

export class RpcError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.data = data
  }

  toJSON(): JsonRpcErrorObject {
    if (this.data === undefined) {
      return { code: this.code, message: this.message }
    }

    return { code: this.code, message: this.message, data: this.data }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length > 0 && value.length <= 64)
}

function hasJsonRpcVersion(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.jsonrpc === '2.0'
}

function hasMethod(value: Record<string, unknown>): boolean {
  return typeof value.method === 'string'
    && value.method.length > 0
    && value.method.length <= 128
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return hasJsonRpcVersion(value)
    && hasMethod(value)
    && 'id' in value
    && isJsonRpcId(value.id)
}

export function isJsonRpcNotification(
  value: unknown,
): value is JsonRpcNotification {
  return hasJsonRpcVersion(value) && hasMethod(value) && !('id' in value)
}

function isJsonRpcErrorObject(value: unknown): value is JsonRpcErrorObject {
  return isRecord(value)
    && typeof value.code === 'number'
    && Number.isInteger(value.code)
    && typeof value.message === 'string'
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (!hasJsonRpcVersion(value) || 'method' in value) {
    return false
  }

  const hasResult = 'result' in value
  const hasError = 'error' in value

  if (hasResult === hasError) {
    return false
  }

  if (hasError) {
    return (value.id === null || isJsonRpcId(value.id))
      && isJsonRpcErrorObject(value.error)
  }

  return isJsonRpcId(value.id)
}

export function isJsonRpcErrorResponse(
  value: JsonRpcResponse,
): value is JsonRpcErrorResponse {
  return 'error' in value
}

export function isConnectMessage(value: unknown): value is ConnectMessage {
  return isRecord(value)
    && value.type === CONNECT_MESSAGE_TYPE
    && value.protocol === PROTOCOL_VERSION
}

export function createConnectMessage(): ConnectMessage {
  return { type: CONNECT_MESSAGE_TYPE, protocol: PROTOCOL_VERSION }
}

export function createRequest(
  id: JsonRpcId,
  method: string,
  params: unknown,
): JsonRpcRequest {
  return { jsonrpc: '2.0', id, method, params }
}

export function createNotification(
  method: string,
  params: unknown,
): JsonRpcNotification {
  return { jsonrpc: '2.0', method, params }
}

export function createSuccessResponse(
  id: JsonRpcId,
  result: unknown,
): JsonRpcSuccessResponse {
  return { jsonrpc: '2.0', id, result }
}

export function createErrorResponse(
  id: JsonRpcId | null,
  error: JsonRpcErrorObject,
): JsonRpcErrorResponse {
  return { jsonrpc: '2.0', id, error }
}

export function toRpcError(exception: unknown): RpcError {
  if (exception instanceof RpcError) {
    return exception
  }

  return new RpcError(ERROR_CODES.internalError, 'Internal error')
}

export function isMethodNotFound(exception: unknown): boolean {
  return exception instanceof RpcError
    && exception.code === ERROR_CODES.methodNotFound
}
