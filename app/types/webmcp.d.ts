interface WebMcpToolAnnotations {
  readOnlyHint?: boolean
  untrustedContentHint?: boolean
  consequentialHint?: boolean
}

interface WebMcpExecuteOptions {
  signal: AbortSignal
}

interface WebMcpTool {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: WebMcpToolAnnotations
  execute: (
    input: Record<string, unknown>,
    options: WebMcpExecuteOptions,
  ) => Promise<string>
}

interface WebMcpRegisterToolOptions {
  signal?: AbortSignal
}

interface WebMcpModelContext {
  registerTool: (
    tool: WebMcpTool,
    options?: WebMcpRegisterToolOptions,
  ) => Promise<unknown> | void
}

interface Document {
  modelContext?: WebMcpModelContext
}

interface Navigator {
  modelContext?: WebMcpModelContext
}
