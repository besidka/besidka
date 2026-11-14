import type { ToolSet } from 'ai'
import { fingerprintTools, jsonSchema } from 'ai'
import type { CallToolResult } from '@ai-sdk/mcp'
import {
  CONNECTOR_REMOTE_TOOL_NAME_MAX_LENGTH,
  CONNECTOR_RESULT_MAX_BYTES,
  CONNECTOR_RESULT_TAG,
  CONNECTOR_TOOL_DESCRIPTION_MAX_BYTES,
  CONNECTOR_TOOL_NAME_MAX_LENGTH,
  CONNECTOR_TOOL_NAME_PREFIX,
  CONNECTOR_TOOL_SCHEMA_MAX_BYTES,
} from '#shared/utils/connectors-policy'
import { truncateToByteBudget } from '~~/server/utils/skills/runtime/text'

const HASH_HEX_LENGTH = 6
const NAME_SEPARATOR = '__'
const NAME_UNSAFE_CHARACTERS = /[^a-zA-Z0-9_-]/g
const ATTRIBUTE_UNSAFE_CHARACTERS = /[^a-zA-Z0-9_.:-]/g
const FRAME_TAG_OPENING = new RegExp(
  `<(\\s*(?:\\/\\s*)?)(${CONNECTOR_RESULT_TAG})(?![\\w-])`,
  'gi',
)
const ANNOTATION_KEYS = [
  'readOnlyHint',
  'destructiveHint',
  'idempotentHint',
  'openWorldHint',
] as const
const MAX_RESOURCE_URI_LENGTH = 200
const MAX_TEXT_FIELD_LENGTH = 200
const textEncoder = new TextEncoder()

export interface ConnectorToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface ConnectorToolDefinition {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: ConnectorToolAnnotations
}

export interface NormalizedToolDefinitions {
  definitions: ConnectorToolDefinition[]
  skippedOversized: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }

  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)

    return `{${entries.join(',')}}`
  }

  return JSON.stringify(value) ?? 'null'
}

export async function connectorSha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(value),
  )

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function pickAnnotations(value: unknown): ConnectorToolAnnotations {
  if (!isRecord(value)) {
    return {}
  }

  const annotations: ConnectorToolAnnotations = {}

  for (const key of ANNOTATION_KEYS) {
    if (typeof value[key] === 'boolean') {
      annotations[key] = value[key]
    }
  }

  return annotations
}

function normalizeInputSchema(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null
  }

  const schema = {
    ...value,
    type: 'object',
    properties: isRecord(value.properties) ? value.properties : {},
  }

  if (
    textEncoder.encode(JSON.stringify(schema)).byteLength
    > CONNECTOR_TOOL_SCHEMA_MAX_BYTES
  ) {
    return null
  }

  return schema
}

/**
 * Reduces a server's `tools/list` to what Besidka reviews, hashes and shows
 * the model: the name, title, a description cut to 1 KiB, the input schema
 * (a tool over 8 KiB is skipped) and the four boolean annotations. Output
 * schemas and `_meta` are dropped. A tool with a missing or oversized name,
 * or a repeated name, is skipped.
 */
export function normalizeToolDefinitions(
  rawTools: readonly unknown[],
): NormalizedToolDefinitions {
  const definitions: ConnectorToolDefinition[] = []
  const seen = new Set<string>()
  let skippedOversized = 0

  for (const rawTool of rawTools) {
    if (!isRecord(rawTool) || typeof rawTool.name !== 'string') {
      continue
    }

    const { name } = rawTool

    if (
      !name
      || name.length > CONNECTOR_REMOTE_TOOL_NAME_MAX_LENGTH
      || seen.has(name)
    ) {
      continue
    }

    const inputSchema = normalizeInputSchema(rawTool.inputSchema)

    if (!inputSchema) {
      skippedOversized += 1

      continue
    }

    seen.add(name)

    const title = typeof rawTool.title === 'string' && rawTool.title
      ? rawTool.title.slice(0, MAX_TEXT_FIELD_LENGTH)
      : undefined
    const description = typeof rawTool.description === 'string'
      ? truncateToByteBudget(
        rawTool.description,
        CONNECTOR_TOOL_DESCRIPTION_MAX_BYTES,
      ).text
      : ''

    definitions.push({
      name,
      ...(title ? { title } : {}),
      description,
      inputSchema,
      annotations: pickAnnotations(rawTool.annotations),
    })
  }

  return { definitions, skippedOversized }
}

export function isDefinitionReadOnly(
  definition: Pick<ConnectorToolDefinition, 'annotations'>,
): boolean {
  return definition.annotations.readOnlyHint === true
}

/**
 * The per-tool baseline: SHA-256 over the `fingerprintTools` digest of the
 * name-keyed definition (description, resolved input schema, title) and the
 * canonical annotations, which that digest omits. A server that flips
 * `readOnlyHint` without touching the description still changes the hash.
 */
export async function hashToolDefinitions(
  definitions: readonly ConnectorToolDefinition[],
): Promise<Map<string, string>> {
  const tools: Record<string, unknown> = Object.create(null)

  for (const definition of definitions) {
    tools[definition.name] = {
      description: definition.description,
      inputSchema: jsonSchema(
        definition.inputSchema as Parameters<typeof jsonSchema>[0],
      ),
      title: definition.title,
    }
  }

  const fingerprints = await fingerprintTools(tools as ToolSet)
  const hashes = new Map<string, string>()

  for (const definition of definitions) {
    hashes.set(
      definition.name,
      await connectorSha256Hex(canonicalJson({
        name: definition.name,
        fingerprint: fingerprints[definition.name],
        annotations: definition.annotations,
      })),
    )
  }

  return hashes
}

/**
 * `mcp__<slug>__<tool>` with characters outside `[a-zA-Z0-9_-]` replaced by
 * `_`. Over 64 characters the name is cut and suffixed with `_` and the
 * first six hex characters of the SHA-256 of the remote name, so two long
 * names that share a prefix stay apart.
 */
export async function buildExposedToolName(
  slug: string,
  remoteName: string,
): Promise<string> {
  const sanitized = remoteName.replace(NAME_UNSAFE_CHARACTERS, '_')
  const name = `${CONNECTOR_TOOL_NAME_PREFIX}${slug}${NAME_SEPARATOR}${sanitized}`

  if (name.length <= CONNECTOR_TOOL_NAME_MAX_LENGTH) {
    return name
  }

  const digest = await connectorSha256Hex(remoteName)
  const suffix = digest.slice(0, HASH_HEX_LENGTH)
  const keep = CONNECTOR_TOOL_NAME_MAX_LENGTH - suffix.length - 1

  return `${name.slice(0, keep)}_${suffix}`
}

export function neutralizeFrameTags(text: string): string {
  return text.replace(FRAME_TAG_OPENING, '‹$1$2')
}

function toAttributeValue(value: string): string {
  return value.replace(ATTRIBUTE_UNSAFE_CHARACTERS, '_')
}

function limitField(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_FIELD_LENGTH) : ''
}

function describeContentItem(item: unknown): string | null {
  if (!isRecord(item) || typeof item.type !== 'string') {
    return null
  }

  if (item.type === 'text') {
    return typeof item.text === 'string' ? item.text : null
  }

  if (item.type === 'image' || item.type === 'audio') {
    return `[${item.type} omitted${
      typeof item.mimeType === 'string'
        ? `: ${limitField(item.mimeType)}`
        : ''
    }]`
  }

  if (item.type === 'resource' && isRecord(item.resource)) {
    const uri = limitField(item.resource.uri).slice(0, MAX_RESOURCE_URI_LENGTH)

    return typeof item.resource.text === 'string'
      ? `[resource ${uri}]\n${item.resource.text}`
      : `[resource omitted: ${uri}]`
  }

  if (item.type === 'resource_link') {
    return `[link ${limitField(item.name)}: ${
      limitField(item.uri).slice(0, MAX_RESOURCE_URI_LENGTH)
    }]`
  }

  return `[${limitField(item.type)} content omitted]`
}

/**
 * The result of a `tools/call` as plain text: text items joined, every other
 * kind described in one line and never forwarded (no images in v1). When the
 * server sent only `structuredContent`, that JSON is the text.
 */
export function callToolResultToText(result: CallToolResult): string {
  const content = (result as { content?: unknown }).content
  const lines = Array.isArray(content)
    ? content
      .map(describeContentItem)
      .filter((line): line is string => line !== null)
    : []

  if (lines.length === 0) {
    const structured = (result as { structuredContent?: unknown })
      .structuredContent

    if (structured !== undefined) {
      return JSON.stringify(structured) ?? ''
    }
  }

  return lines.join('\n')
}

export interface FramedResult {
  text: string
  bytes: number
  isTruncated: boolean
}

/**
 * Cuts the text to 64 KiB, neutralizes any copy of the frame tag inside it
 * so a server cannot close the frame early, and wraps it as
 * `<untrusted_tool_result connector="<slug>" tool="<name>">`.
 */
export function frameUntrustedResult(input: {
  slug: string
  toolName: string
  text: string
}): FramedResult {
  const cut = truncateToByteBudget(input.text, CONNECTOR_RESULT_MAX_BYTES)
  const body = neutralizeFrameTags(cut.text)
  const notice = cut.isTruncated
    ? '\n[Truncated: the result was longer than 64 KiB.]'
    : ''
  const framed = `<${CONNECTOR_RESULT_TAG} connector="${
    toAttributeValue(input.slug)
  }" tool="${toAttributeValue(input.toolName)}">\n${body}${notice}\n</${
    CONNECTOR_RESULT_TAG
  }>`

  return {
    text: framed,
    bytes: textEncoder.encode(cut.text).byteLength,
    isTruncated: cut.isTruncated,
  }
}

export function redactSecrets(
  text: string,
  secrets: readonly string[],
): string {
  let redacted = text

  for (const secret of secrets) {
    if (secret.length >= 8) {
      redacted = redacted.split(secret).join('[redacted]')
    }
  }

  return redacted
}
