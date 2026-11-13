import { vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import { skillBlobKey } from '~~/server/utils/skills/storage'

type TestDb = ReturnType<typeof import('~~/server/utils/db').useDb>

export interface FakeSkillObject {
  bytes: Uint8Array
  uploaded: Date
}

export interface FakeSkillBucket {
  objects: Map<string, FakeSkillObject>
  deleteCalls: string[][]
  putCalls: string[]
  listCalls: Array<{ prefix: string, cursor?: string, limit?: number }>
  put: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
}

export interface FakeSkillKv {
  values: Map<string, string>
  get: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

export function createFakeSkillBucket(pageSize = 1000): FakeSkillBucket {
  const objects = new Map<string, FakeSkillObject>()
  const deleteCalls: string[][] = []
  const putCalls: string[] = []
  const listCalls: FakeSkillBucket['listCalls'] = []

  return {
    objects,
    deleteCalls,
    putCalls,
    listCalls,
    put: vi.fn(async (key: string, bytes: Uint8Array) => {
      putCalls.push(key)
      objects.set(key, { bytes, uploaded: new Date() })
    }),
    get: vi.fn(async (key: string) => {
      const object = objects.get(key)

      if (!object) {
        return null
      }

      return {
        arrayBuffer: async () => {
          return object.bytes.buffer.slice(
            object.bytes.byteOffset,
            object.bytes.byteOffset + object.bytes.byteLength,
          )
        },
      }
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys]

      deleteCalls.push([...list])

      for (const key of list) {
        objects.delete(key)
      }
    }),
    list: vi.fn(async (options: {
      prefix: string
      cursor?: string
      limit?: number
    }) => {
      listCalls.push(options)

      const matching = [...objects.keys()]
        .filter(key => key.startsWith(options.prefix))
        .filter(key => !options.cursor || key > options.cursor)
        .sort()
      const page = matching.slice(0, pageSize)
      const isTruncated = matching.length > page.length

      return {
        objects: page.map((key) => {
          return { key, uploaded: objects.get(key)!.uploaded }
        }),
        truncated: isTruncated,
        cursor: isTruncated ? page[page.length - 1] : undefined,
      }
    }),
  }
}

export function createFakeSkillKv(): FakeSkillKv {
  const values = new Map<string, string>()

  return {
    values,
    get: vi.fn(async (key: string) => {
      return values.get(key) ?? null
    }),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key)
    }),
  }
}

export function shaOf(seed: string): string {
  return Array.from(seed, (character) => {
    return character.charCodeAt(0).toString(16).padStart(2, '0')
  }).join('').padStart(64, '0').slice(-64)
}

export function putFakeBlob(
  bucket: FakeSkillBucket,
  userId: number,
  skillId: string,
  sha256: string,
  uploaded: Date = new Date(0),
): string {
  const key = skillBlobKey(userId, skillId, sha256)

  bucket.objects.set(key, { bytes: new Uint8Array([1]), uploaded })

  return key
}

export async function seedSkill(
  db: TestDb,
  userId: number,
  values: Partial<typeof schema.skills.$inferInsert> = {},
): Promise<string> {
  const [skill] = await db.insert(schema.skills).values({
    userId,
    name: `skill-${Math.random().toString(36).slice(2, 10)}`,
    description: 'A skill',
    licenseClass: 'authored',
    licenseClassifierVersion: 1,
    sourceKind: 'editor',
    currentVersion: 1,
    filesCount: 0,
    bytes: 0,
    status: 'ready',
    createdVia: 'app',
    ...values,
  }).returning({ id: schema.skills.id })

  return skill!.id
}

export async function seedSkillVersion(
  db: TestDb,
  input: {
    skillId: string
    userId: number
    version: number
    files: Array<{ path: string, sha256: string }>
  },
): Promise<void> {
  await db.insert(schema.skillVersions).values({
    skillId: input.skillId,
    userId: input.userId,
    version: input.version,
    origin: 'editor',
    sha256: shaOf(`canonical${input.version}`),
    filesCount: input.files.length,
    bytes: input.files.length,
    licenseClass: 'authored',
  })

  for (const file of input.files) {
    await db.insert(schema.skillFiles).values({
      skillId: input.skillId,
      userId: input.userId,
      version: input.version,
      path: file.path,
      blobSha256: file.sha256,
      bytes: 1,
      kind: file.path === 'SKILL.md' ? 'skill-md' : 'reference',
    })
  }
}
