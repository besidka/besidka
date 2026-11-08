import type {
  ARTIFACT_KINDS,
  DISPLAY_MODES,
  LOG_LEVELS,
  METHODS,
  STORAGE_MODES,
  THEMES,
} from './constants.ts'

export type ArtifactKind = typeof ARTIFACT_KINDS[number]

export type Theme = typeof THEMES[number]

export type DisplayMode = typeof DISPLAY_MODES[number]

export type StorageMode = typeof STORAGE_MODES[number]

export type LogLevel = typeof LOG_LEVELS[number]

export type JsonValue
  = | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue }

export interface HostCapabilities {
  storage: StorageMode
  complete: boolean
}

export interface HostContext {
  theme: Theme
  displayMode: DisplayMode
  locale: string
  capabilities: HostCapabilities
}

export interface AppCapabilities {
  kinds: ArtifactKind[]
}

export interface InitializeParams {
  protocolVersion: number
  appCapabilities: AppCapabilities
}

export interface InitializeResult {
  protocolVersion: number
  hostContext: HostContext
}

export interface ArtifactPayload {
  kind: ArtifactKind
  title: string
  content: string
}

export interface ToolInputPartialParams {
  arguments: ArtifactPayload
}

export interface ToolResultContent extends ArtifactPayload {
  artifactId?: string
  version?: number
}

export interface ToolResultParams {
  structuredContent: ToolResultContent
}

export interface HostContextChangedParams {
  theme?: Theme
  displayMode?: DisplayMode
}

export interface SizeChangedParams {
  height: number
}

export interface OpenLinkParams {
  url: string
}

export type EmptyResult = Record<string, never>

export interface LogMessageParams {
  level: LogLevel
  data: {
    message: string
    stack?: string
  }
}

export interface StorageKeyParams {
  key: string
}

export interface StorageSetParams {
  key: string
  value: JsonValue
}

export interface StorageListParams {
  prefix?: string
}

export interface StorageGetResult {
  value: JsonValue | null
}

export interface StorageListResult {
  keys: string[]
}

export interface CompleteParams {
  prompt: string
  maxOutputTokens?: number
}

export interface CompleteResult {
  text: string
}

export interface RuntimeRequests {
  [METHODS.initialize]: [InitializeParams, InitializeResult]
  [METHODS.openLink]: [OpenLinkParams, EmptyResult]
  [METHODS.storageGet]: [StorageKeyParams, StorageGetResult]
  [METHODS.storageSet]: [StorageSetParams, EmptyResult]
  [METHODS.storageDelete]: [StorageKeyParams, EmptyResult]
  [METHODS.storageList]: [StorageListParams, StorageListResult]
  [METHODS.complete]: [CompleteParams, CompleteResult]
}

export interface RuntimeNotifications {
  [METHODS.initialized]: EmptyResult
  [METHODS.sizeChanged]: SizeChangedParams
  [METHODS.message]: LogMessageParams
}

export interface HostNotifications {
  [METHODS.toolInputPartial]: ToolInputPartialParams
  [METHODS.toolResult]: ToolResultParams
  [METHODS.hostContextChanged]: HostContextChangedParams
}

export type RuntimeRequestMethod = keyof RuntimeRequests

export type RuntimeNotificationMethod = keyof RuntimeNotifications

export type HostNotificationMethod = keyof HostNotifications

export type RequestParams<Method extends RuntimeRequestMethod>
  = RuntimeRequests[Method][0]

export type RequestResult<Method extends RuntimeRequestMethod>
  = RuntimeRequests[Method][1]
