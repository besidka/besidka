import { vi } from 'vitest'
import { REGISTRY_OFFICIAL_META_KEY } from '~~/server/utils/connectors/registry-entry'

export const REGISTRY_UPDATED_AT = '2026-11-10T08:00:00.000Z'

interface RegistryEntryOptions {
  name: string
  title?: string
  description?: string
  version?: string
  remotes?: unknown[]
  status?: string
  updatedAt?: string
}

export function registryEntry(options: RegistryEntryOptions) {
  return {
    server: {
      name: options.name,
      title: options.title,
      description: options.description ?? `${options.name} description`,
      version: options.version ?? '1.0.0',
      remotes: options.remotes ?? [{
        type: 'streamable-http',
        url: `https://mcp.${options.name.replace(/[^a-z0-9]/gi, '-')}.example.com/mcp`,
      }],
    },
    _meta: {
      [REGISTRY_OFFICIAL_META_KEY]: {
        status: options.status ?? 'active',
        updatedAt: options.updatedAt ?? REGISTRY_UPDATED_AT,
        isLatest: true,
      },
    },
  }
}

export function registryPage(entries: unknown[], nextCursor?: string) {
  return {
    servers: entries,
    metadata: { count: entries.length, nextCursor },
  }
}

export interface RegistryFetchCall {
  url: URL
  headers: Headers
}

export function createRegistryFetch(
  respond: (call: RegistryFetchCall, index: number) => Response,
) {
  const calls: RegistryFetchCall[] = []
  const fetchImpl = vi.fn(async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const call = {
      url: new URL(input.toString()),
      headers: new Headers(init?.headers),
    }

    calls.push(call)

    return respond(call, calls.length - 1)
  }) as unknown as typeof fetch

  return { calls, fetchImpl }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function pagedRegistryFetch(pages: unknown[][]) {
  return createRegistryFetch((call) => {
    const cursorIndex = call.url.searchParams.has('cursor')
      ? Number(call.url.searchParams.get('cursor'))
      : 0
    const entries = pages[cursorIndex]

    if (!entries) {
      return jsonResponse(registryPage([]))
    }

    const hasNext = cursorIndex + 1 < pages.length

    return jsonResponse(registryPage(
      entries,
      hasNext ? String(cursorIndex + 1) : undefined,
    ))
  })
}
