import { useRequestLogger } from '~~/server/utils/logging/request-logger'

interface McpToolCall {
  result?: { isError?: boolean } | null
  durationMs: number
}

export function buildMcpToolOutcomeFields(call: McpToolCall) {
  return {
    outcome: call.result?.isError ? 'error' : 'success',
    duration_ms: Math.round(call.durationMs),
  }
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('mcp:tool:called', ({ result, durationMs, event }) => {
    try {
      useRequestLogger(event).set({
        mcp: buildMcpToolOutcomeFields({ result, durationMs }),
      })
    } catch {
      return
    }
  })
})
