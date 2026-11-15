import { z } from 'zod'
import {
  CONNECTOR_HEADER_NAME_PATTERN,
  CONNECTOR_REJECTED_HEADER_NAMES,
  REGISTRY_CURSOR_MAX_LENGTH,
  REGISTRY_DESCRIPTION_MAX_CHARS,
  REGISTRY_TITLE_MAX_LENGTH,
} from '#shared/utils/connectors-policy'
import { parseSafeOutboundUrl } from '~~/server/utils/net/safe-url'

export const REGISTRY_OFFICIAL_META_KEY
  = 'io.modelcontextprotocol.registry/official'

const REGISTRY_NAME_PATTERN = /^[A-Za-z0-9._/-]{3,200}$/
const TEMPLATE_MARKER_PATTERN = /[{}$]|%7b|%7d|%24/i
const SEPARATOR_AND_CONTROL_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]/gu
const INVISIBLE_FORMAT_CHARACTERS = /[\p{Cf}\u{E0000}-\u{E007F}]/gu
const HEADER_NAMES_MAX = 10

export const REGISTRY_SKIP_REASONS = [
  'shape',
  'inactive',
  'no-remote',
  'template',
  'unsafe-url',
  'erased',
] as const

export type RegistrySkipReason = typeof REGISTRY_SKIP_REASONS[number]

export interface RegistryServerRow {
  id: string
  name: string
  title: string | null
  description: string
  remoteUrl: string
  remoteType: 'streamable-http'
  headerNames: string[]
  status: 'active'
  registryUpdatedAt: Date
}

export type RegistryEntryOutcome
  = | { kind: 'upsert', row: RegistryServerRow }
    | { kind: 'delete', name: string }
    | { kind: 'skip', name: string | null, reason: RegistrySkipReason }

export const registryPageSchema = z.object({
  servers: z.array(z.unknown()),
  metadata: z.object({
    nextCursor: z.string().max(REGISTRY_CURSOR_MAX_LENGTH).nullish(),
  }).nullish(),
})

const registryEntrySchema = z.object({
  server: z.object({
    name: z.string().regex(REGISTRY_NAME_PATTERN),
    title: z.string().nullish(),
    description: z.string().nullish(),
    version: z.string().min(1).max(128),
    remotes: z.array(z.unknown()).nullish(),
  }),
  _meta: z.record(z.string(), z.unknown()).nullish(),
})

const officialMetaSchema = z.object({
  status: z.string().min(1).max(32),
  updatedAt: z.string().refine((value) => {
    return !Number.isNaN(Date.parse(value))
  }),
})

const remoteSchema = z.object({
  type: z.string(),
  url: z.string(),
  headers: z.array(z.unknown()).nullish(),
})

const headerSchema = z.object({
  name: z.string(),
})

function cleanText(value: string, maxLength: number): string {
  const cleaned = value
    .replace(SEPARATOR_AND_CONTROL_CHARACTERS, ' ')
    .replace(INVISIBLE_FORMAT_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim()

  return Array.from(cleaned).slice(0, maxLength).join('')
}

function readHeaderNames(headers: unknown[] | null | undefined): string[] {
  const names: string[] = []

  for (const candidate of headers ?? []) {
    const header = headerSchema.safeParse(candidate)

    if (!header.success) {
      continue
    }

    const { name } = header.data

    if (
      !CONNECTOR_HEADER_NAME_PATTERN.test(name)
      || CONNECTOR_REJECTED_HEADER_NAMES.includes(name.toLowerCase())
      || names.some((known) => {
        return known.toLowerCase() === name.toLowerCase()
      })
    ) {
      continue
    }

    names.push(name)

    if (names.length >= HEADER_NAMES_MAX) {
      break
    }
  }

  return names
}

type RemoteChoice
  = | { ok: true, url: URL, headerNames: string[] }
    | { ok: false, reason: RegistrySkipReason }

function chooseRemote(remotes: unknown[] | null | undefined): RemoteChoice {
  let reason: RegistrySkipReason = 'no-remote'

  for (const candidate of remotes ?? []) {
    const remote = remoteSchema.safeParse(candidate)

    if (!remote.success || remote.data.type !== 'streamable-http') {
      continue
    }

    if (TEMPLATE_MARKER_PATTERN.test(remote.data.url)) {
      reason = 'template'

      continue
    }

    const parsed = parseSafeOutboundUrl(remote.data.url)

    if (!parsed.ok) {
      reason = 'unsafe-url'

      continue
    }

    return {
      ok: true,
      url: parsed.url,
      headerNames: readHeaderNames(remote.data.headers),
    }
  }

  return { ok: false, reason }
}

function readOfficialMeta(meta: Record<string, unknown> | null | undefined) {
  const official = officialMetaSchema.safeParse(
    meta?.[REGISTRY_OFFICIAL_META_KEY],
  )

  return official.success ? official.data : null
}

/**
 * Classifies one registry list entry: a row to upsert, a name whose row must
 * go (deleted upstream), or a skip with a counted reason. An entry that turns
 * invalid is not just skipped by the caller: its existing row is removed too.
 * Each entry is parsed on its own, so one odd shape never drops a page.
 */
export function classifyRegistryEntry(
  rawEntry: unknown,
  isErased: (name: string) => boolean,
): RegistryEntryOutcome {
  const entry = registryEntrySchema.safeParse(rawEntry)

  if (!entry.success) {
    return { kind: 'skip', name: null, reason: 'shape' }
  }

  const { server } = entry.data
  const official = readOfficialMeta(entry.data._meta)

  if (!official) {
    return { kind: 'skip', name: server.name, reason: 'shape' }
  }

  if (official.status === 'deleted') {
    return { kind: 'delete', name: server.name }
  }

  if (official.status !== 'active') {
    return { kind: 'skip', name: server.name, reason: 'inactive' }
  }

  if (isErased(server.name)) {
    return { kind: 'skip', name: server.name, reason: 'erased' }
  }

  const remote = chooseRemote(server.remotes)

  if (!remote.ok) {
    return { kind: 'skip', name: server.name, reason: remote.reason }
  }

  const title = cleanText(server.title ?? '', REGISTRY_TITLE_MAX_LENGTH)

  return {
    kind: 'upsert',
    row: {
      id: `${server.name}@${server.version}`,
      name: server.name,
      title: title || null,
      description: cleanText(
        server.description ?? '',
        REGISTRY_DESCRIPTION_MAX_CHARS,
      ),
      remoteUrl: remote.url.toString(),
      remoteType: 'streamable-http',
      headerNames: remote.headerNames,
      status: 'active',
      registryUpdatedAt: new Date(official.updatedAt),
    },
  }
}
