import type { Project, ProjectChatsResponse, ProjectsResponse } from '#shared/types/projects.d'
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
    projectId: overrides.projectId ?? null,
    projectName: overrides.projectName ?? null,
  }
}

export function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id ?? 'project-1',
    name: overrides.name ?? 'Project 1',
    instructions: overrides.instructions ?? null,
    memory: overrides.memory ?? null,
    memoryStatus: overrides.memoryStatus ?? 'idle',
    memoryUpdatedAt: overrides.memoryUpdatedAt ?? null,
    memoryDirtyAt: overrides.memoryDirtyAt ?? null,
    memoryProvider: overrides.memoryProvider ?? null,
    memoryModel: overrides.memoryModel ?? null,
    memoryError: overrides.memoryError ?? null,
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

export function createProjectsResponse(
  overrides: Partial<ProjectsResponse> = {},
): ProjectsResponse {
  return {
    pinned: overrides.pinned ?? [],
    projects: overrides.projects ?? [],
  }
}

export function createProjectChatsResponse(
  overrides: Partial<ProjectChatsResponse> = {},
): ProjectChatsResponse {
  return {
    project: overrides.project ?? createProject(),
    pinned: overrides.pinned ?? [],
    chats: overrides.chats ?? [],
    nextCursor: overrides.nextCursor ?? null,
  }
}
