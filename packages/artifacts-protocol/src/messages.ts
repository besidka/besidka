import type {
  ARTIFACT_KINDS,
  CLIPBOARD_FAILURE_REASONS,
  CLIPBOARD_MIME_TYPES,
  DIAGRAM_EXPORT_ACTIONS,
  DISPLAY_MODES,
  REQUESTABLE_DISPLAY_MODES,
  LOG_LEVELS,
  METHODS,
  STORAGE_MODES,
  THEMES,
} from './constants.ts'
import type { DiagramLimitCode } from './mermaid-limits.ts'

export type ArtifactKind = typeof ARTIFACT_KINDS[number]

export type Theme = typeof THEMES[number]

export type DisplayMode = typeof DISPLAY_MODES[number]

export type RequestableDisplayMode = typeof REQUESTABLE_DISPLAY_MODES[number]

export type ClipboardMimeType = typeof CLIPBOARD_MIME_TYPES[number]

export type ClipboardFailureReason = typeof CLIPBOARD_FAILURE_REASONS[number]

export type StorageMode = typeof STORAGE_MODES[number]

export type LogLevel = typeof LOG_LEVELS[number]

export type DiagramExportAction = typeof DIAGRAM_EXPORT_ACTIONS[number]

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
    code?: DiagramLimitCode
    limit?: number
    found?: number
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
  system?: string
  maxOutputTokens?: number
}

export interface CompleteResult {
  text: string
}

export interface ClipboardWriteParams {
  text: string
  mimeType?: ClipboardMimeType
  userActivation: boolean
}

export type ClipboardWriteResult
  = | { copied: true }
    | { copied: false, reason: ClipboardFailureReason }

export interface RequestDisplayModeParams {
  mode: RequestableDisplayMode
  userActivation: boolean
}

export interface RequestDisplayModeResult {
  displayMode: DisplayMode
}

export interface OpenDiagramViewerParams {
  source: string
  userActivation: boolean
}

export interface DiagramExportParams {
  source: string
  action: DiagramExportAction
  userActivation: boolean
}

export interface DiagramExportResult {
  completed: boolean
}

export interface RuntimeRequests {
  [METHODS.initialize]: [InitializeParams, InitializeResult]
  [METHODS.openLink]: [OpenLinkParams, EmptyResult]
  [METHODS.clipboardWrite]: [ClipboardWriteParams, ClipboardWriteResult]
  [METHODS.requestDisplayMode]: [
    RequestDisplayModeParams,
    RequestDisplayModeResult,
  ]
  [METHODS.openDiagramViewer]: [OpenDiagramViewerParams, EmptyResult]
  [METHODS.diagramExport]: [DiagramExportParams, DiagramExportResult]
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
