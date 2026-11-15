import { z } from 'zod'

export const LEGAL_ADMIN_OPT_OUT_LIST_LIMIT = 200

export const legalNoticeApprovalInputSchema = z.object({
  recipientEstimate: z.number().int().min(0),
}).strict()

export type LegalNoticeApprovalInput = z.infer<
  typeof legalNoticeApprovalInputSchema
>

export const consentVersionApprovalInputSchema = z.object({
  version: z.string().trim().min(1).max(32),
}).strict()

export type ConsentVersionApprovalInput = z.infer<
  typeof consentVersionApprovalInputSchema
>

export const legalNoticeOptOutInputSchema = z.object({
  userId: z.number().int().positive(),
}).strict()

export type LegalNoticeOptOutInput = z.infer<
  typeof legalNoticeOptOutInputSchema
>
