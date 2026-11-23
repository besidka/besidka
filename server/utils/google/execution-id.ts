/**
 * The identity of one run of a Google write: the approval id when the user
 * approved the call (the option `wrapApprovedExecutions` passes), or the
 * `executionId` the server passes for a call the user set to Always allow
 * (`createGoogleRunGate`), which has no approval. A write derives its
 * request id from this value, never from the provider's tool call id or the
 * model's input, so one run can never create twice. A call with neither is
 * refused before any token or request.
 */
export function readExecutionId(options: unknown): string | null {
  const { approvalId, executionId } = (options ?? {}) as {
    approvalId?: unknown
    executionId?: unknown
  }
  const id = typeof approvalId === 'string' && approvalId
    ? approvalId
    : executionId

  return typeof id === 'string' && id ? id : null
}
