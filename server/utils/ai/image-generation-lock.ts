import { and, eq, lte } from 'drizzle-orm'
import { createError } from 'evlog'
import * as schema from '~~/server/db/schema'

export const IMAGE_GENERATION_LEASE_MS = 10 * 60 * 1000
export const IMAGE_GENERATION_COOLDOWN_MS = 10 * 1000

export interface ImageGenerationLease {
  userId: number
  token: string
}

interface ImageGenerationLeaseOptions {
  database?: ReturnType<typeof useDb>
  now?: Date
}

export async function acquireImageGenerationLease(
  userId: number,
  options: ImageGenerationLeaseOptions = {},
): Promise<ImageGenerationLease> {
  const database = options.database || useDb()
  const now = options.now || new Date()
  const token = crypto.randomUUID()
  const expiresAt = new Date(now.getTime() + IMAGE_GENERATION_LEASE_MS)
  const acquiredLease = await database
    .insert(schema.imageGenerationLocks)
    .values({
      userId,
      token,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.imageGenerationLocks.userId,
      set: {
        token,
        expiresAt,
        updatedAt: now,
      },
      setWhere: lte(schema.imageGenerationLocks.expiresAt, now),
    })
    .returning({
      token: schema.imageGenerationLocks.token,
    })
    .get()

  if (!acquiredLease || acquiredLease.token !== token) {
    throw createError({
      message: 'An image is already being generated.',
      status: 429,
      why: 'Only one image generation can run at a time for this account.',
      fix: 'Wait for the current image to finish, then try again.',
    })
  }

  return { userId, token }
}

export async function releaseImageGenerationLease(
  lease: ImageGenerationLease,
  options: ImageGenerationLeaseOptions = {},
): Promise<boolean> {
  const database = options.database || useDb()
  const now = options.now || new Date()
  const expiresAt = new Date(now.getTime() + IMAGE_GENERATION_COOLDOWN_MS)
  const releasedLease = await database
    .update(schema.imageGenerationLocks)
    .set({
      expiresAt,
      updatedAt: now,
    })
    .where(and(
      eq(schema.imageGenerationLocks.userId, lease.userId),
      eq(schema.imageGenerationLocks.token, lease.token),
    ))
    .returning({
      token: schema.imageGenerationLocks.token,
    })
    .get()

  return releasedLease?.token === lease.token
}
