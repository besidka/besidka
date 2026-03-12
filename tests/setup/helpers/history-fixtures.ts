import type { Folder, FolderChatsResponse, FoldersResponse } from '#shared/types/folders.d'
import type { HistoryChat, HistoryResponse } from '#shared/types/history.d'

const DEFAULT_CREATED_AT = '2026-03-01T08:00:00.000Z'
const DEFAULT_ACTIVITY_AT = '2026-03-11T08:00:00.000Z'

export function createHistoryChat(
  overrides: Partial<HistoryChat> = {},
): HistoryChat {
  return {
    id: overrides.id ?? 'chat-1',
    slug: overrides.slug ?? overrides.id ?? 'chat-1',
    title: overrides.title ?? 'Chat 1',
    createdAt: overrides.createdAt ?? DEFAULT_CREATED_AT,
    activityAt: overrides.activityAt ?? DEFAULT_ACTIVITY_AT,
    pinnedAt: overrides.pinnedAt ?? null,
    folderId: overrides.folderId ?? null,
    folderName: overrides.folderName ?? null,
  }
}

export function createFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: overrides.id ?? 'folder-1',
    name: overrides.name ?? 'Folder 1',
    pinnedAt: overrides.pinnedAt ?? null,
    archivedAt: overrides.archivedAt ?? null,
    activityAt: overrides.activityAt ?? DEFAULT_ACTIVITY_AT,
    createdAt: overrides.createdAt ?? DEFAULT_CREATED_AT,
  }
}

export function createHistoryResponse(
  overrides: Partial<HistoryResponse> = {},
): HistoryResponse {
  return {
    pinned: overrides.pinned ?? [],
    chats: overrides.chats ?? [],
    nextCursor: overrides.nextCursor ?? null,
  }
}

export function createFoldersResponse(
  overrides: Partial<FoldersResponse> = {},
): FoldersResponse {
  return {
    pinned: overrides.pinned ?? [],
    folders: overrides.folders ?? [],
  }
}

export function createFolderChatsResponse(
  overrides: Partial<FolderChatsResponse> = {},
): FolderChatsResponse {
  return {
    folder: overrides.folder ?? createFolder(),
    pinned: overrides.pinned ?? [],
    chats: overrides.chats ?? [],
    nextCursor: overrides.nextCursor ?? null,
  }
}
