import { toIsoTimestamp } from '~~/server/utils/mcp/private/text'

export interface McpShareRow {
  slug: string | null
  expiresAt: Date | null
  indexable: boolean
  showFiles: boolean
  allowBranch: boolean
}

export interface McpShareSummary {
  url?: string | null
  expiresAt: string | null
  indexable: boolean
  showFiles: boolean
  allowBranch: boolean
}

export function buildMcpShareUrl(
  siteUrl: string,
  shareSlug: string | null,
): string | null {
  if (!shareSlug) {
    return null
  }

  return `${siteUrl.replace(/\/$/, '')}/shared/${shareSlug}`
}

/**
 * The share link is a capability: anyone holding it can read the chat. It is
 * included only when the caller asks for it, which the tools do for tokens
 * that can also manage shares (chats:write).
 */
export function toMcpShareSummary(
  siteUrl: string,
  share: McpShareRow,
  includeUrl: boolean,
): McpShareSummary {
  return {
    ...(includeUrl ? { url: buildMcpShareUrl(siteUrl, share.slug) } : {}),
    expiresAt: toIsoTimestamp(share.expiresAt),
    indexable: share.indexable,
    showFiles: share.showFiles,
    allowBranch: share.allowBranch,
  }
}
