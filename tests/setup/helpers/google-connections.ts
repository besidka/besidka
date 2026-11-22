import { vi } from 'vitest'

export const GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com'
export const GOOGLE_CLIENT_SECRET = 'test-client-secret'
export const GOOGLE_SUBJECT = '108000000000000000001'
export const GOOGLE_EMAIL = 'person@example.test'
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const GRANTED_SCOPE_STRING = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  DRIVE_FILE_SCOPE,
].join(' ')

export interface FakeGoogleReply {
  status: number
  body: Record<string, unknown> | string
}

export interface FakeGoogleRequest {
  url: string
  method: string
  form: URLSearchParams
  redirect: RequestRedirect | undefined
}

export interface FakeGoogleOptions {
  token?: (form: URLSearchParams) => FakeGoogleReply
  revoke?: (form: URLSearchParams) => FakeGoogleReply
}

function encodeSegment(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function makeIdToken(claims: Record<string, unknown> = {}): string {
  return [
    encodeSegment({ alg: 'RS256', typ: 'JWT' }),
    encodeSegment({
      iss: 'https://accounts.google.com',
      aud: GOOGLE_CLIENT_ID,
      sub: GOOGLE_SUBJECT,
      email: GOOGLE_EMAIL,
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    }),
    'signature',
  ].join('.')
}

export function defaultTokenReply(form: URLSearchParams): FakeGoogleReply {
  if (form.get('grant_type') === 'refresh_token') {
    return {
      status: 200,
      body: {
        access_token: `access-refreshed-${Math.random()}`,
        expires_in: 3599,
        token_type: 'Bearer',
        scope: GRANTED_SCOPE_STRING,
      },
    }
  }

  return {
    status: 200,
    body: {
      access_token: 'access-initial',
      refresh_token: 'refresh-initial',
      expires_in: 3599,
      token_type: 'Bearer',
      scope: GRANTED_SCOPE_STRING,
      id_token: makeIdToken(),
    },
  }
}

/**
 * A stand-in for Google's token and revoke endpoints. Tests never reach
 * Google: every request lands here and is recorded with its form body.
 */
export function createFakeGoogle(options: FakeGoogleOptions = {}) {
  const requests: FakeGoogleRequest[] = []
  const fetch = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    const form = new URLSearchParams(String(init.body ?? ''))

    requests.push({
      url: url.toString(),
      method: init.method ?? 'GET',
      form,
      redirect: init.redirect,
    })

    let reply: FakeGoogleReply

    if (url.pathname === '/token') {
      reply = (options.token ?? defaultTokenReply)(form)
    } else if (url.pathname === '/revoke') {
      reply = options.revoke?.(form) ?? { status: 200, body: {} }
    } else {
      reply = { status: 404, body: { error: 'not_found' } }
    }

    return new Response(
      typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body),
      {
        status: reply.status,
        headers: { 'content-type': 'application/json' },
      },
    )
  })

  return {
    fetch,
    requests,
    tokenRequests: () => requests.filter((request) => {
      return request.url.endsWith('/token')
    }),
    revokeRequests: () => requests.filter((request) => {
      return request.url.endsWith('/revoke')
    }),
  }
}

export type FakeGoogle = ReturnType<typeof createFakeGoogle>

/**
 * Server code reads the shared runtime config object of the node test
 * setup, not a global, so the Google client values are written onto it and
 * the returned function puts the previous values back.
 */
export async function useGoogleRuntimeConfig(
  overrides: Record<string, string> = {},
): Promise<() => void> {
  const runtimeConfig = (await import('#app/nuxt')).useRuntimeConfig() as
    unknown as Record<string, unknown>
  const keys = [
    'googleClientId',
    'googleClientSecret',
    'googleDriveClientId',
    'googleDriveClientSecret',
  ]
  const previous = Object.fromEntries(keys.map((key) => {
    return [key, runtimeConfig[key]]
  }))

  Object.assign(runtimeConfig, {
    googleClientId: GOOGLE_CLIENT_ID,
    googleClientSecret: GOOGLE_CLIENT_SECRET,
    googleDriveClientId: '',
    googleDriveClientSecret: '',
    ...overrides,
  })

  return () => {
    Object.assign(runtimeConfig, previous)
  }
}

export const BYO_CLIENT_ID = 'owner-test-client-abcd.apps.googleusercontent.com'
export const BYO_CLIENT_SECRET = 'test-owner-secret-value-0123456789'

interface ByoAccessSeedDb {
  insert: (table: any) => { values: (values: any) => Promise<unknown> }
  update: (table: any) => {
    set: (values: any) => { where: (condition: any) => Promise<unknown> }
  }
}

/**
 * Seeds what the real feature evaluator needs for the bring-your-own gate:
 * `admin` gives the `admin` role with 2FA on (the user is already
 * verified), `grant` gives allow grants for `google.drive` and
 * `google.byo` without any role (a flag grant to a non-admin), and
 * `optIn` the Labs opt-in for both flags.
 */
export async function seedGoogleByoAccess(
  db: ByoAccessSeedDb,
  userId: number,
  input: {
    admin?: boolean
    grant?: boolean
    optIn?: boolean
    gmail?: boolean
    calendar?: boolean
  } = {},
): Promise<void> {
  const schema = await import('~~/server/db/schema')
  const { eq } = await import('drizzle-orm')
  const flags = [
    'google.drive',
    'google.byo',
    ...(input.gmail ?? true ? ['google.gmail'] : []),
    ...(input.calendar ?? false ? ['google.calendar'] : []),
  ]

  await db.update(schema.users)
    .set({ twoFactorEnabled: true })
    .where(eq(schema.users.id, userId))

  if (input.admin ?? true) {
    await db.insert(schema.userRoles).values({ userId, role: 'admin' })
  }

  if (input.grant) {
    for (const flag of flags) {
      await db.insert(schema.featureGrants).values({
        userId,
        flag,
        effect: 'allow',
      })
    }
  }

  if (input.optIn ?? true) {
    for (const flag of flags) {
      await db.insert(schema.featureOptIns).values({
        userId,
        flag,
        optedInAt: new Date('2026-11-01T00:00:00.000Z'),
      })
    }
  }
}

export function createFakeBucket() {
  const deletedBatches: string[][] = []

  return {
    deletedBatches,
    delete: vi.fn(async (keys: string | string[]) => {
      deletedBatches.push(Array.isArray(keys) ? [...keys] : [keys])
    }),
  }
}

export type FakeBucket = ReturnType<typeof createFakeBucket>
