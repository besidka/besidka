import type {
  ComplianceBlockedCounts,
  MemoryCategory,
  MemorySensitiveCategory,
} from '#shared/types/memory.d'
import type {
  MemoryInstructEntryFields,
  MemoryInstructRejection,
} from '#shared/types/memory-instruct.d'
import {
  MEMORY_LIMITS,
  SENSITIVE_TOPIC_REFUSAL_MESSAGE,
  alwaysInjectedMemoryCategories,
  neverStoreKinds,
} from '#shared/utils/memory-policy'
import { memoryEntryInputSchema } from '#shared/utils/memory-schemas'
import {
  evaluateMemoryEntry,
  recordBlockedCounts,
  recordSensitiveDetection,
} from '~~/server/utils/memory/compliance'
import type { ComplianceLogger } from '~~/server/utils/memory/compliance'

export const MEMORY_INSTRUCT_COMPLIANCE_ORIGIN = 'memory-instruct'

const NEVER_STORE_MESSAGE = 'This memory contains data that cannot be stored'

const INVALID_ENTRY_MESSAGE = 'Invalid memory entry'

const BULLET_PREFIX_PATTERN = /^\s*(?:[-*•]|\d+[.)])\s+/u

export interface MemoryInstructComplianceTally {
  blocked: ComplianceBlockedCounts
  sensitiveCategories: Set<MemorySensitiveCategory>
}

export type MemoryInstructCheck
  = | { allowed: true, fields: MemoryInstructEntryFields }
    | {
      allowed: false
      rejection: MemoryInstructRejection
      status: 400 | 422
    }

export function createMemoryInstructComplianceTally() {
  const tally: MemoryInstructComplianceTally = {
    blocked: {},
    sensitiveCategories: new Set(),
  }

  return tally
}

export function recordMemoryInstructCompliance(
  tally: MemoryInstructComplianceTally,
  logger: ComplianceLogger,
): void {
  recordBlockedCounts(tally.blocked, logger, MEMORY_INSTRUCT_COMPLIANCE_ORIGIN)
  recordSensitiveDetection(
    [...tally.sensitiveCategories],
    logger,
    MEMORY_INSTRUCT_COMPLIANCE_ORIGIN,
  )
}

export function isSingletonMemoryCategory(category: MemoryCategory): boolean {
  return (alwaysInjectedMemoryCategories as readonly string[])
    .includes(category)
}

export function memoryInstructEntryCap(projectId: string | null): number {
  return projectId === null
    ? MEMORY_LIMITS.maxAccountEntries
    : MEMORY_LIMITS.maxProjectEntries
}

function describeNeverStoreKinds(kinds: readonly string[]): string {
  return neverStoreKinds
    .filter(kind => kinds.includes(kind.id))
    .map((kind) => {
      return `${kind.label} (${kind.id})`
    })
    .join(', ')
}

function describeSensitiveCategories(
  categories: MemorySensitiveCategory[],
): string {
  if (categories.length === 0) {
    return 'This entry is marked sensitive.'
  }

  return `This entry looks like sensitive data (${categories.join(', ')}).`
}

/**
 * Checks one proposed entry the way the entry CRUD routes do: the field rules
 * of `memoryEntryInputSchema` (title and description lengths, the body byte
 * caps, the smaller cap of profile and preferences) and then the compliance
 * gate. A refusal is returned, never thrown, so preview can show it as a
 * rejected row and apply can turn it into a 400 or 422. Never-store kinds and
 * sensitive categories are added to the tally so the caller logs them once.
 */
export function checkMemoryInstructEntry(
  input: { category: MemoryCategory } & MemoryInstructEntryFields,
  tally: MemoryInstructComplianceTally,
): MemoryInstructCheck {
  const parsed = memoryEntryInputSchema.safeParse({
    category: input.category,
    title: input.title,
    description: input.description,
    body: input.body,
  })

  if (!parsed.success) {
    const [issue] = parsed.error.issues

    return {
      allowed: false,
      status: 400,
      rejection: {
        message: INVALID_ENTRY_MESSAGE,
        why: issue
          ? `${issue.path.join('.') || 'entry'}: ${issue.message}`
          : 'The entry does not match the memory format.',
      },
    }
  }

  const fields = {
    title: parsed.data.title,
    description: parsed.data.description,
    body: parsed.data.body,
  }
  const verdict = evaluateMemoryEntry({ ...fields, sensitivity: 'none' })

  if (verdict.allowed) {
    return { allowed: true, fields }
  }

  if (verdict.reason === 'sensitive-topic') {
    for (const category of verdict.detectedCategories) {
      tally.sensitiveCategories.add(category)
    }

    return {
      allowed: false,
      status: 422,
      rejection: {
        message: SENSITIVE_TOPIC_REFUSAL_MESSAGE,
        why: describeSensitiveCategories(verdict.detectedCategories),
      },
    }
  }

  for (const kind of verdict.kinds) {
    tally.blocked[kind] = (tally.blocked[kind] ?? 0) + 1
  }

  return {
    allowed: false,
    status: 422,
    rejection: {
      message: NEVER_STORE_MESSAGE,
      why: `Detected: ${describeNeverStoreKinds(verdict.kinds)}.`,
    },
  }
}

function normalizeMemoryLine(line: string): string {
  return line
    .replace(BULLET_PREFIX_PATTERN, '')
    .trim()
    .toLowerCase()
}

/**
 * Adds the lines of `addition` that the stored body does not already hold
 * (compared without bullet markers, case and surrounding spaces) to the end
 * of `stored`. Used when the model edits an entry whose body it was not
 * shown, so no stored fact can be lost.
 */
export function appendMemoryBodyLines(
  stored: string,
  addition: string,
): string {
  const storedLines = new Set(
    stored.split('\n').map(normalizeMemoryLine).filter(Boolean),
  )
  const newLines = addition
    .split('\n')
    .filter((line) => {
      const normalized = normalizeMemoryLine(line)

      if (!normalized || storedLines.has(normalized)) {
        return false
      }

      storedLines.add(normalized)

      return true
    })

  if (newLines.length === 0) {
    return stored
  }

  return `${stored.trimEnd()}\n${newLines.join('\n')}`
}
