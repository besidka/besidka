export type ChatContextGroup = 'outputs' | 'inputs' | 'used'

export type ChatContextItemKind
  = | 'image'
    | 'research'
    | 'file'
    | 'knowledge'
    | 'memory'
    | 'chat-search'
    | 'web-source'
    | 'web-search'

export interface ChatContextItemMeta {
  url?: string
  downloadUrl?: string
  mediaType?: string
  action?: string
  provider?: string
  count?: number
  domain?: string
}

export interface ChatContextItem {
  id: string
  sectionId: string
  kind: ChatContextItemKind
  title: string
  messageId: string
  href?: string
  meta?: ChatContextItemMeta
}

export interface ChatContextShare {
  active: boolean
  url?: string
  expiresAt?: string | null
}

export interface ChatContextCost {
  amount: number
  isEstimated: boolean
}

export interface ChatContextChat {
  slug: string
  title: string
  project: { id: string, name: string } | null
  memoryExcluded: boolean
  share: ChatContextShare | null
  cost: ChatContextCost | null
  models: string[]
}

export interface ChatContextCounts {
  outputs: number
  inputs: number
  used: number
}

export interface ChatContextResponse {
  chat: ChatContextChat
  outputs: ChatContextItem[]
  inputs: ChatContextItem[]
  used: ChatContextItem[]
  counts: ChatContextCounts
  kindCounts: Partial<Record<ChatContextItemKind, number>>
  truncated: boolean
}

export interface SharedChatContextResponse {
  chat: {
    slug: string
    title: string
    cost: ChatContextCost | null
    models: string[]
    allowBranch: boolean
  }
  outputs: ChatContextItem[]
  inputs: ChatContextItem[]
  used: ChatContextItem[]
  counts: ChatContextCounts
  kindCounts: Partial<Record<ChatContextItemKind, number>>
  truncated: boolean
}
