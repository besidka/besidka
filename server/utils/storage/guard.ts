import {
  getEffectiveUserFilePolicy,
  getUserStorageUsageBytes,
} from '~~/server/utils/files/file-governance'
import { createStorageFullError } from '~~/server/utils/storage/errors'

export interface AssertStorageAvailableInput {
  userId: number
  additionalBytes: number
  db?: ReturnType<typeof useDb>
}

/**
 * Refuses a write that would take the user over the one storage allowance.
 * Reads the shared total across every category, so a file, an artifact
 * version and project knowledge all draw on the same quota. Throws a 413
 * `Storage is full` that names the Storage page; existing data is untouched.
 */
export async function assertStorageAvailable(
  input: AssertStorageAvailableInput,
): Promise<void> {
  const db = input.db ?? useDb()
  const [policy, usedBytes] = await Promise.all([
    getEffectiveUserFilePolicy(input.userId, db),
    getUserStorageUsageBytes(input.userId, db),
  ])

  if (usedBytes + input.additionalBytes <= policy.maxStorageBytes) {
    return
  }

  throw createStorageFullError({
    usedBytes,
    totalBytes: policy.maxStorageBytes,
  })
}
