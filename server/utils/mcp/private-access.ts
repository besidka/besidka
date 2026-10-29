import type { KVNamespace } from '@cloudflare/workers-types'
import type { LegalConsentStatus } from '#shared/types/legal-consent.d'
import { createError } from 'evlog'
import {
  MCP_PRIVATE_TOOL_RATE_LIMIT,
  MCP_PRIVATE_WRITE_RATE_LIMIT,
} from '~~/config/mcp-server'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import {
  getLegalConsentStatus,
  readLegalConsent,
} from '~~/server/utils/legal/consent'
import type { McpAuthContext } from '~~/server/utils/mcp/auth'
import type { McpPrivateToolName } from '~~/server/utils/mcp/tool-scopes'
import {
  MCP_PRIVATE_TOOL_SCOPES,
  isMcpWriteTool,
} from '~~/server/utils/mcp/tool-scopes'

type DbClient = ReturnType<typeof useDb>

const MCP_RATE_LIMIT_KEY_PREFIX = 'mcp:rate-limit'

const consentFixByStatus: Record<
  Exclude<LegalConsentStatus, 'current'>,
  string
> = {
  missing: 'You have not accepted the Terms of Use and the consent to '
    + 'store sensitive information yet.',
  withdrawn: 'You withdrew your consent to store sensitive information.',
  outdated: 'The Terms of Use and the consent text changed since you last '
    + 'agreed to them.',
}

export function assertMcpToolAuthorized(
  auth: McpAuthContext | undefined,
  toolName: McpPrivateToolName,
): McpAuthContext {
  if (!auth) {
    throw createError({
      status: 401,
      message: 'Sign in to Besidka through your MCP client to use '
        + `${toolName}.`,
    })
  }

  const scope = MCP_PRIVATE_TOOL_SCOPES[toolName]

  if (!auth.scopes.includes(scope)) {
    throw createError({
      status: 403,
      message: `This connection was not granted ${scope}. Reconnect `
        + 'Besidka and allow it.',
    })
  }

  return auth
}

export function buildMcpConsentRefusalMessage(
  status: Exclude<LegalConsentStatus, 'current'>,
  siteUrl: string,
): string {
  return `${consentFixByStatus[status]} Until you agree, connected apps `
    + `can neither read nor change your Besidka data. Open ${siteUrl}, `
    + 'sign in and confirm the consent dialog (or Profile, Security, '
    + 'Privacy & consent), then try again.'
}

/**
 * The legal-consent gate of the app, applied to every private MCP tool,
 * reads included. The refusal goes into the message, because the MCP
 * client only ever shows an error's message.
 */
export async function requireMcpLegalConsent(
  userId: number,
  siteUrl: string,
  db: DbClient = useDb(),
): Promise<void> {
  const status = getLegalConsentStatus(await readLegalConsent(userId, db))

  if (status === 'current') {
    return
  }

  throw createError({
    status: 403,
    message: buildMcpConsentRefusalMessage(status, siteUrl),
    data: { reason: 'legal-consent', consentStatus: status },
  })
}

function createRateLimitError(retryAfter: number | null) {
  const wait = retryAfter === null ? 'a moment' : `${retryAfter} seconds`

  return createError({
    status: 429,
    message: `Too many Besidka tool calls. Wait ${wait} and try again.`,
  })
}

export async function enforceMcpToolRateLimit(
  userId: number,
  toolName: McpPrivateToolName,
  kv: KVNamespace = useKV(),
): Promise<void> {
  const allTools = createAuthRateLimitStorage(
    kv,
    `${MCP_RATE_LIMIT_KEY_PREFIX}:all`,
  )
  const callResult = await allTools.consume(
    String(userId),
    MCP_PRIVATE_TOOL_RATE_LIMIT,
  )

  if (!callResult.allowed) {
    throw createRateLimitError(callResult.retryAfter)
  }

  if (!isMcpWriteTool(toolName)) {
    return
  }

  const writeTools = createAuthRateLimitStorage(
    kv,
    `${MCP_RATE_LIMIT_KEY_PREFIX}:write`,
  )
  const writeResult = await writeTools.consume(
    String(userId),
    MCP_PRIVATE_WRITE_RATE_LIMIT,
  )

  if (!writeResult.allowed) {
    throw createRateLimitError(writeResult.retryAfter)
  }
}
