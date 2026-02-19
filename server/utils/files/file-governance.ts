import type { UIMessage } from 'ai'
import type { FilePolicy } from '#shared/types/files.d'
import { and, eq, lt, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

const DEFAULT_STORAGE_BYTES = 20 * 1024 * 1024 // 20MB
const DEFAULT_MAX_FILES_PER_MESSAGE = 10
const DEFAULT_MAX_MESSAGE_FILES_BYTES = 1000 * 1024 * 1024 // 1GB
const DEFAULT_FILE_RETENTION_DAYS = 30
const DEFAULT_RETENTION_TIGHTENING_GRACE_DAYS = 7
const DEFAULT_IMAGE_TRANSFORM_LIMIT_TOTAL = 0
const DEFAULT_GLOBAL_TRANSFORM_LIMIT_MONTHLY = 1000

export interface GlobalTransformStats {
  monthKey: string
  used: number
  limit: number
  remaining: number
}

interface StoragePolicyRow {
  tier: 'free' | 'vip'
  storage: number
  maxFilesPerMessage: number
  maxMessageFilesBytes: number
  fileRetentionDays: number | null
  imageTransformLimitTotal: number | null
  imageTransformUsedTotal: number
}

interface TransformSlotReservation {
  reserved: boolean
  used: number
  limit: number | null
  reason?: 'disabled' | 'user-limit' | 'global-limit'
}

interface OwnedFile {
  id: string
  storageKey: string
  size: number
}

export function getCurrentMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

export function extractStorageKeyFromFileUrl(url: string): string | null {
  if (!url) {
    return null
  }

  const [cleanedUrl] = url.split('?')
  const cleaned = cleanedUrl?.replace(/^\/files\//, '')

  if (cleaned && !cleaned.includes('/')) {
    return cleaned
  }

  return null
}

export async function getOrCreateStoragePolicyRow(
  userId: number,
): Promise<StoragePolicyRow> {
  const db = useDb()
  const config = useRuntimeConfig().public
  const defaultMaxFilesPerMessage = config.maxFilesPerMessage
    || DEFAULT_MAX_FILES_PER_MESSAGE
  const defaultMaxMessageFilesBytes = config.maxMessageFilesBytes
    || DEFAULT_MAX_MESSAGE_FILES_BYTES

  await db
    .insert(schema.storages)
    .values({
      userId,
      storage: DEFAULT_STORAGE_BYTES,
      tier: 'free',
      maxFilesPerMessage: defaultMaxFilesPerMessage,
      maxMessageFilesBytes: defaultMaxMessageFilesBytes,
      fileRetentionDays: DEFAULT_FILE_RETENTION_DAYS,
      imageTransformLimitTotal: DEFAULT_IMAGE_TRANSFORM_LIMIT_TOTAL,
      imageTransformUsedTotal: 0,
    })
    .onConflictDoNothing()
    .run()

  const row = await db.query.storages.findFirst({
    where(storages, { eq }) {
      return eq(storages.userId, userId)
    },
    columns: {
      tier: true,
      storage: true,
      maxFilesPerMessage: true,
      maxMessageFilesBytes: true,
      fileRetentionDays: true,
      imageTransformLimitTotal: true,
      imageTransformUsedTotal: true,
    },
  })

  if (!row) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to initialize user storage policy',
    })
  }

  return row
}

export function getEffectiveFilePolicy(
  policy: StoragePolicyRow,
): FilePolicy {
  const config = useRuntimeConfig()
  const hardMaxStorageBytes = config.filesHardMaxStorageBytes
    || Number.MAX_SAFE_INTEGER
  const maxStorageBytes = Math.min(policy.storage, hardMaxStorageBytes)
  const retentionDays = policy.fileRetentionDays ?? DEFAULT_FILE_RETENTION_DAYS

  return {
    tier: policy.tier,
    maxStorageBytes: Math.max(maxStorageBytes, 0),
    maxFilesPerMessage: Math.max(policy.maxFilesPerMessage, 0),
    maxMessageFilesBytes: Math.max(policy.maxMessageFilesBytes, 0),
    fileRetentionDays: policy.tier === 'vip'
      ? null
      : Math.max(retentionDays, 0),
    imageTransformLimitTotal: policy.imageTransformLimitTotal,
    imageTransformUsedTotal: policy.imageTransformUsedTotal,
  }
}

export async function getEffectiveUserFilePolicy(
  userId: number,
): Promise<FilePolicy> {
  const row = await getOrCreateStoragePolicyRow(userId)

  return getEffectiveFilePolicy(row)
}

export async function getEffectiveRetentionDays(
  userId: number,
): Promise<number | null> {
  const policy = await getEffectiveUserFilePolicy(userId)

  return policy.fileRetentionDays
}

export async function getUserStorageUsageBytes(
  userId: number,
): Promise<number> {
  const db = useDb()
  const result = await db
    .select({
      used: sql<number>`coalesce(sum(${schema.files.size}), 0)`,
    })
    .from(schema.files)
    .where(eq(schema.files.userId, userId))
    .get()

  return result?.used ?? 0
}

export interface RecomputeUserFileExpiryOptions {
  graceDays?: number
  now?: Date
}

export interface RecomputeUserFileExpiryResult {
  userId: number
  retentionDays: number | null
  graceDays: number
  totalFiles: number
  updatedFiles: number
}

export async function recomputeUserFileExpiry(
  userId: number,
  options: RecomputeUserFileExpiryOptions = {},
): Promise<RecomputeUserFileExpiryResult> {
  const db = useDb()
  const now = options.now || new Date()
  const graceDays = Math.max(
    options.graceDays ?? DEFAULT_RETENTION_TIGHTENING_GRACE_DAYS,
    0,
  )
  const retentionDays = await getEffectiveRetentionDays(userId)
  const files = await db.query.files.findMany({
    where(files, { eq }) {
      return eq(files.userId, userId)
    },
    columns: {
      id: true,
      createdAt: true,
      expiresAt: true,
    },
  })

  if (files.length === 0) {
    return {
      userId,
      retentionDays,
      graceDays,
      totalFiles: 0,
      updatedFiles: 0,
    }
  }

  if (retentionDays === null) {
    const filesWithExpiry = files.filter((file) => {
      return file.expiresAt !== null
    })

    if (filesWithExpiry.length === 0) {
      return {
        userId,
        retentionDays,
        graceDays,
        totalFiles: files.length,
        updatedFiles: 0,
      }
    }

    await db
      .update(schema.files)
      .set({
        expiresAt: null,
      })
      .where(eq(schema.files.userId, userId))
      .run()

    return {
      userId,
      retentionDays,
      graceDays,
      totalFiles: files.length,
      updatedFiles: filesWithExpiry.length,
    }
  }

  const minimumExpiry = addDays(now, graceDays)
  let updatedFiles = 0

  for (const file of files) {
    const baseExpiry = addDays(file.createdAt, retentionDays)
    const nextExpiry = baseExpiry < minimumExpiry
      ? minimumExpiry
      : baseExpiry
    const currentExpiryMs = file.expiresAt
      ? file.expiresAt.getTime()
      : null

    if (currentExpiryMs === nextExpiry.getTime()) {
      continue
    }

    await db
      .update(schema.files)
      .set({
        expiresAt: nextExpiry,
      })
      .where(and(
        eq(schema.files.id, file.id),
        eq(schema.files.userId, userId),
      ))
      .run()

    updatedFiles++
  }

  return {
    userId,
    retentionDays,
    graceDays,
    totalFiles: files.length,
    updatedFiles,
  }
}

export async function getGlobalMonthlyTransformStats(
): Promise<GlobalTransformStats> {
  const db = useDb()
  const monthKey = getCurrentMonthKey()
  const limit = getGlobalMonthlyTransformLimit()

  await db
    .insert(schema.imageTransformUsageMonthly)
    .values({
      monthKey,
      transformsLimit: limit,
    })
    .onConflictDoNothing()
    .run()

  await db
    .update(schema.imageTransformUsageMonthly)
    .set({
      transformsLimit: limit,
    })
    .where(eq(schema.imageTransformUsageMonthly.monthKey, monthKey))
    .run()

  const row = await db.query.imageTransformUsageMonthly.findFirst({
    where(imageTransformUsageMonthly, { eq }) {
      return eq(imageTransformUsageMonthly.monthKey, monthKey)
    },
    columns: {
      monthKey: true,
      transformsUsed: true,
      transformsLimit: true,
    },
  })

  if (!row) {
    return {
      monthKey,
      used: 0,
      limit,
      remaining: limit,
    }
  }

  return {
    monthKey: row.monthKey,
    used: row.transformsUsed,
    limit: row.transformsLimit,
    remaining: Math.max(row.transformsLimit - row.transformsUsed, 0),
  }
}

export async function reserveImageTransformSlots(
  userId: number,
): Promise<TransformSlotReservation> {
  const policy = await getOrCreateStoragePolicyRow(userId)

  if (
    policy.imageTransformLimitTotal !== null
    && policy.imageTransformLimitTotal <= 0
  ) {
    return {
      reserved: false,
      used: policy.imageTransformUsedTotal,
      limit: policy.imageTransformLimitTotal,
      reason: 'disabled',
    }
  }

  const userReservation = await reserveUserTransformSlot(userId, policy)

  if (!userReservation.reserved) {
    return userReservation
  }

  const globalReservation = await reserveGlobalTransformSlot()

  if (!globalReservation.reserved) {
    await releaseUserTransformSlot(userId)

    return {
      reserved: false,
      used: userReservation.used,
      limit: userReservation.limit,
      reason: 'global-limit',
    }
  }

  return userReservation
}

export async function releaseImageTransformSlots(
  userId: number,
): Promise<void> {
  await releaseUserTransformSlot(userId)
  await releaseGlobalTransformSlot()
}

export async function validateMessageFilePolicy(
  userId: number,
  parts: UIMessage['parts'],
): Promise<void> {
  if (!parts || parts.length === 0) {
    return
  }

  const fileParts = parts.filter(part => part.type === 'file')

  if (fileParts.length === 0) {
    return
  }

  const policy = await getEffectiveUserFilePolicy(userId)

  if (fileParts.length > policy.maxFilesPerMessage) {
    throw createError({
      statusCode: 400,
      statusMessage: `You can attach a maximum of ${policy.maxFilesPerMessage} files per message`,
    })
  }

  const storageKeys = fileParts.map((part) => {
    const storageKey = extractStorageKeyFromFileUrl(part.url)

    if (!storageKey) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid attached file URL',
      })
    }

    return storageKey
  })

  const uniqueStorageKeys = Array.from(new Set(storageKeys))
  const files = await useDb().query.files.findMany({
    where(files, { and, eq, inArray }) {
      return and(
        eq(files.userId, userId),
        inArray(files.storageKey, uniqueStorageKeys),
      )
    },
    columns: {
      storageKey: true,
      size: true,
    },
  })

  if (files.length !== uniqueStorageKeys.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'One or more attached files are unavailable',
    })
  }

  const sizeMap = new Map<string, number>()

  for (const file of files) {
    sizeMap.set(file.storageKey, file.size)
  }

  const totalFilesSize = storageKeys.reduce((size, storageKey) => {
    return size + (sizeMap.get(storageKey) || 0)
  }, 0)

  if (totalFilesSize > policy.maxMessageFilesBytes) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Attached files exceed the maximum total size per message',
    })
  }
}

export async function getOwnedFilesByStorageKeys(
  userId: number,
  storageKeys: string[],
) {
  if (storageKeys.length === 0) {
    return new Map<string, OwnedFile>()
  }

  const uniqueStorageKeys = Array.from(new Set(storageKeys))
  const files = await useDb().query.files.findMany({
    where(files, { and, eq, inArray }) {
      return and(
        eq(files.userId, userId),
        inArray(files.storageKey, uniqueStorageKeys),
      )
    },
    columns: {
      id: true,
      storageKey: true,
      size: true,
    },
  })

  const map = new Map<string, OwnedFile>()

  for (const file of files) {
    map.set(file.storageKey, file)
  }

  return map
}

async function reserveUserTransformSlot(
  userId: number,
  policy: StoragePolicyRow,
): Promise<TransformSlotReservation> {
  const db = useDb()
  const userLimit = policy.imageTransformLimitTotal
  let reserved

  if (userLimit === null) {
    reserved = await db
      .update(schema.storages)
      .set({
        imageTransformUsedTotal: sql`${schema.storages.imageTransformUsedTotal} + 1`,
      })
      .where(eq(schema.storages.userId, userId))
      .returning({
        used: schema.storages.imageTransformUsedTotal,
        limit: schema.storages.imageTransformLimitTotal,
      })
      .get()
  } else {
    reserved = await db
      .update(schema.storages)
      .set({
        imageTransformUsedTotal: sql`${schema.storages.imageTransformUsedTotal} + 1`,
      })
      .where(and(
        eq(schema.storages.userId, userId),
        lt(
          schema.storages.imageTransformUsedTotal,
          schema.storages.imageTransformLimitTotal,
        ),
      ))
      .returning({
        used: schema.storages.imageTransformUsedTotal,
        limit: schema.storages.imageTransformLimitTotal,
      })
      .get()
  }

  if (!reserved) {
    return {
      reserved: false,
      used: policy.imageTransformUsedTotal,
      limit: userLimit,
      reason: 'user-limit',
    }
  }

  return {
    reserved: true,
    used: reserved.used,
    limit: reserved.limit,
  }
}

async function releaseUserTransformSlot(userId: number): Promise<void> {
  await useDb()
    .update(schema.storages)
    .set({
      imageTransformUsedTotal: sql`
        case
          when ${schema.storages.imageTransformUsedTotal} > 0
            then ${schema.storages.imageTransformUsedTotal} - 1
          else 0
        end
      `,
    })
    .where(eq(schema.storages.userId, userId))
    .run()
}

async function reserveGlobalTransformSlot(
): Promise<TransformSlotReservation> {
  const db = useDb()
  const monthKey = getCurrentMonthKey()
  const limit = getGlobalMonthlyTransformLimit()

  await db
    .insert(schema.imageTransformUsageMonthly)
    .values({
      monthKey,
      transformsLimit: limit,
    })
    .onConflictDoNothing()
    .run()

  const reserved = await db
    .update(schema.imageTransformUsageMonthly)
    .set({
      transformsUsed: sql`${schema.imageTransformUsageMonthly.transformsUsed} + 1`,
      transformsLimit: limit,
    })
    .where(and(
      eq(schema.imageTransformUsageMonthly.monthKey, monthKey),
      lt(
        schema.imageTransformUsageMonthly.transformsUsed,
        schema.imageTransformUsageMonthly.transformsLimit,
      ),
    ))
    .returning({
      used: schema.imageTransformUsageMonthly.transformsUsed,
      limit: schema.imageTransformUsageMonthly.transformsLimit,
    })
    .get()

  if (!reserved) {
    const current = await db.query.imageTransformUsageMonthly.findFirst({
      where(imageTransformUsageMonthly, { eq }) {
        return eq(imageTransformUsageMonthly.monthKey, monthKey)
      },
      columns: {
        transformsUsed: true,
        transformsLimit: true,
      },
    })

    return {
      reserved: false,
      used: current?.transformsUsed ?? 0,
      limit: current?.transformsLimit ?? limit,
      reason: 'global-limit',
    }
  }

  return {
    reserved: true,
    used: reserved.used,
    limit: reserved.limit,
  }
}

async function releaseGlobalTransformSlot(): Promise<void> {
  const monthKey = getCurrentMonthKey()
  const limit = getGlobalMonthlyTransformLimit()

  await useDb()
    .update(schema.imageTransformUsageMonthly)
    .set({
      transformsUsed: sql`
        case
          when ${schema.imageTransformUsageMonthly.transformsUsed} > 0
            then ${schema.imageTransformUsageMonthly.transformsUsed} - 1
          else 0
        end
      `,
      transformsLimit: limit,
    })
    .where(eq(schema.imageTransformUsageMonthly.monthKey, monthKey))
    .run()
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function getGlobalMonthlyTransformLimit(): number {
  return useRuntimeConfig().filesGlobalTransformLimitMonthly
    ?? DEFAULT_GLOBAL_TRANSFORM_LIMIT_MONTHLY
}
