import { z } from 'zod'
import { gatewayIds } from '#shared/utils/gateways'
import {
  MEMORY_LIMITS,
  alwaysInjectedMemoryCategories,
  memoryCategories,
  memoryOrigins,
  memorySensitiveCategories,
  memorySensitivities,
} from '#shared/utils/memory-policy'

const SINGLE_LINE_PATTERN = /^[^\r\n]*$/

export function memoryByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function isAlwaysInjectedCategory(category: string): boolean {
  return (alwaysInjectedMemoryCategories as readonly string[])
    .includes(category)
}

const titleField = z
  .string()
  .trim()
  .min(1)
  .max(MEMORY_LIMITS.maxTitleChars)
  .refine(value => SINGLE_LINE_PATTERN.test(value), {
    message: 'Title must be a single line',
  })

const descriptionField = z
  .string()
  .trim()
  .min(1)
  .max(MEMORY_LIMITS.maxDescriptionChars)
  .refine(value => SINGLE_LINE_PATTERN.test(value), {
    message: 'Description must be a single line',
  })

const bodyField = z
  .string()
  .min(1)
  .refine(value => memoryByteLength(value) <= MEMORY_LIMITS.maxBodyBytes, {
    message: `Body must be at most ${MEMORY_LIMITS.maxBodyBytes} bytes`,
  })

const categoryField = z.enum(memoryCategories)

const sensitivityField = z.enum(memorySensitivities)

const sensitiveCategoryField = z.enum(memorySensitiveCategories)

interface MemoryEntryCrossRuleValue {
  category?: string
  body?: string
  sensitivity?: string
  sensitiveCategory?: string | null
}

function addAlwaysInjectedBodyIssue(
  value: MemoryEntryCrossRuleValue,
  context: z.RefinementCtx,
): void {
  if (value.category === undefined || value.body === undefined) {
    return
  }

  if (!isAlwaysInjectedCategory(value.category)) {
    return
  }

  const bodyBytes = memoryByteLength(value.body)

  if (bodyBytes <= MEMORY_LIMITS.maxAlwaysInjectedBodyBytes) {
    return
  }

  context.addIssue({
    code: 'custom',
    path: ['body'],
    message: `Body of ${value.category} entries must be at most `
      + `${MEMORY_LIMITS.maxAlwaysInjectedBodyBytes} bytes`,
  })
}

function addSensitiveCategoryIssue(
  value: MemoryEntryCrossRuleValue,
  context: z.RefinementCtx,
  treatMissingSensitivityAsNone: boolean,
): void {
  if (value.sensitiveCategory === undefined) {
    return
  }

  if (value.sensitiveCategory === null) {
    return
  }

  if (value.sensitivity === 'special') {
    return
  }

  if (value.sensitivity === undefined && !treatMissingSensitivityAsNone) {
    return
  }

  context.addIssue({
    code: 'custom',
    path: ['sensitiveCategory'],
    message: 'A sensitive category requires sensitivity "special"',
  })
}

export const memoryEntryInputSchema = z
  .object({
    projectId: z.string().min(1).nullable().optional(),
    category: categoryField,
    title: titleField,
    description: descriptionField,
    body: bodyField,
    sensitivity: sensitivityField.optional(),
    sensitiveCategory: sensitiveCategoryField.nullable().optional(),
    origin: z.enum(memoryOrigins).optional(),
  })
  .superRefine((value, context) => {
    addAlwaysInjectedBodyIssue(value, context)
    addSensitiveCategoryIssue(value, context, true)
  })

export const memoryEntryPatchSchema = z
  .object({
    category: categoryField.optional(),
    title: titleField.optional(),
    description: descriptionField.optional(),
    body: bodyField.optional(),
    sensitivity: sensitivityField.optional(),
    sensitiveCategory: sensitiveCategoryField.nullable().optional(),
  })
  .refine(value => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  })
  .superRefine((value, context) => {
    addAlwaysInjectedBodyIssue(value, context)
    addSensitiveCategoryIssue(value, context, false)
  })

export const memorySettingsPatchShape = {
  memoryEnabled: z.boolean().optional(),
  memoryExtractionEnabled: z.boolean().optional(),
  chatSearchEnabled: z.boolean().optional(),
  aboutMe: z.null().optional(),
  profileMemoryModel: z.string().trim().min(1).max(200).nullable().optional(),
  profileMemoryGateway: z.enum(gatewayIds).nullable().optional(),
  projectMemoryModel: z.string().trim().min(1).max(200).nullable().optional(),
  projectMemoryGateway: z.enum(gatewayIds).nullable().optional(),
}

interface MemorySettingsPatchValue {
  profileMemoryModel?: string | null
  profileMemoryGateway?: string | null
  projectMemoryModel?: string | null
  projectMemoryGateway?: string | null
}

export function refineMemorySettingsPatch(
  value: MemorySettingsPatchValue,
  context: z.RefinementCtx,
): void {
  if (value.profileMemoryGateway && !value.profileMemoryModel) {
    context.addIssue({
      code: 'custom',
      path: ['profileMemoryGateway'],
      message: 'A gateway needs a model',
    })
  }

  if (value.projectMemoryGateway && !value.projectMemoryModel) {
    context.addIssue({
      code: 'custom',
      path: ['projectMemoryGateway'],
      message: 'A gateway needs a model',
    })
  }
}
