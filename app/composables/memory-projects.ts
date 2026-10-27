export interface MemoryProjectOption {
  id: string
  name: string
  memoryStatus: string
  isArchived: boolean
}

interface MemoryProjectRecord {
  id: string
  name: string
  memoryStatus: string
}

interface MemoryProjectsResponse {
  pinned: MemoryProjectRecord[]
  projects: MemoryProjectRecord[]
}

function listProjects(
  response: MemoryProjectsResponse | null | undefined,
  isArchived: boolean,
): MemoryProjectOption[] {
  if (!response) {
    return []
  }

  return [...response.pinned, ...response.projects].map((project) => {
    return {
      id: project.id,
      name: project.name,
      memoryStatus: project.memoryStatus,
      isArchived,
    }
  })
}

export function useMemoryProjects() {
  const active = useLazyFetch('/api/v1/projects', {
    key: 'memory-scope-projects',
    query: { limit: 100 },
  })
  const archived = useLazyFetch('/api/v1/projects', {
    key: 'memory-scope-projects-archived',
    query: { archived: true, limit: 100 },
  })

  const projects = computed<MemoryProjectOption[]>(() => {
    const activeProjects = listProjects(active.data.value, false)
    const activeIds = new Set(activeProjects.map(project => project.id))
    const archivedProjects = listProjects(archived.data.value, true)
      .filter(project => !activeIds.has(project.id))

    return [...activeProjects, ...archivedProjects]
  })

  const isLoading = computed<boolean>(() => {
    return (active.pending.value && !active.data.value)
      || (archived.pending.value && !archived.data.value)
  })

  const error = computed(() => {
    return active.error.value ?? archived.error.value ?? null
  })

  async function refresh() {
    await Promise.all([active.refresh(), archived.refresh()])
  }

  return {
    projects,
    isLoading,
    error,
    refresh,
  }
}
