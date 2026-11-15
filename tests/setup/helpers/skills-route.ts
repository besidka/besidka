import { vi } from 'vitest'

export interface SkillsRouteEvent {
  context: Record<string, unknown>
  params: Record<string, string>
  headers: Record<string, string>
  body?: unknown
  query?: Record<string, string>
  status?: number
  req: { formData: () => Promise<FormData> }
  res: { headers: Headers }
}

/**
 * Stand-in for the portable `nuxt/server` helpers the skills routes use,
 * reading from a plain test event. Loaded through `vi.mock` so the factory
 * stays free of schema imports.
 */
export async function skillsNuxtServerMockFactory() {
  return {
    defineEventHandler: (handler: unknown) => handler,
    readValidatedBody: async (
      event: SkillsRouteEvent,
      validate: (body: unknown) => unknown,
    ) => validate(event.body),
    getRequestHeader: (event: SkillsRouteEvent, name: string) => {
      return event.headers[name.toLowerCase()]
    },
    getRouterParams: (event: SkillsRouteEvent) => event.params,
    getQuery: (event: SkillsRouteEvent) => event.query ?? {},
    setResponseStatus: (event: SkillsRouteEvent, status: number) => {
      event.status = status
    },
  }
}

export function createSkillsRouteEvent(
  partial: Partial<SkillsRouteEvent> = {},
): SkillsRouteEvent {
  return {
    context: {},
    params: {},
    req: {
      formData: async () => {
        throw new Error('No form data in this event')
      },
    },
    res: { headers: new Headers() },
    ...partial,
    headers: { 'content-length': '200', ...partial.headers },
  }
}

export function createUploadEvent(
  bytes: Uint8Array,
  fileName = 'skill.zip',
  overrides: { contentLength?: string, fieldName?: string } = {},
): SkillsRouteEvent {
  const form = new FormData()

  form.append(
    overrides.fieldName ?? 'file',
    new File([bytes as BlobPart], fileName),
  )

  return createSkillsRouteEvent({
    headers: {
      'content-length': overrides.contentLength ?? String(bytes.length + 200),
    },
    req: { formData: async () => form },
  })
}

export function stubSkillsRouteGlobals(input: {
  userId: number
  db: unknown
  kv: unknown
  bucket: unknown
}) {
  vi.stubGlobal('useDb', () => input.db)
  vi.stubGlobal('useKV', () => input.kv)
  vi.stubGlobal('useFileStorage', () => input.bucket)
  vi.stubGlobal('useUserSession', async () => {
    return input.userId > 0 ? { user: { id: String(input.userId) } } : null
  })
  vi.stubGlobal('useUnauthorizedError', () => {
    throw Object.assign(new Error('Unauthorized'), { status: 401 })
  })
}
